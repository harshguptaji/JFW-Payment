import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import multer from 'multer';
import {v2 as cloudinary} from 'cloudinary';
import {createServer} from 'node:http';
import {Server} from 'socket.io';
const {MONGO_URI, CLIENT_ORIGIN='http://localhost:5173', PORT=5000}=process.env;
if(!MONGO_URI) throw new Error('MONGO_URI is required');
const origins=['http://localhost:5173','http://127.0.0.1:5173',...CLIENT_ORIGIN.split(',')].map(x=>x.trim().replace(/\/+$/,''));
const app=express(), server=createServer(app);
const options={origin:origins,methods:['GET','POST','PATCH','OPTIONS']};
const io=new Server(server,{cors:options});
app.use(cors(options)); app.use(express.json());
cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET,secure:true});
const Event=mongoose.model('Event',new mongoose.Schema({
 eventName:{type:String,required:true,trim:true,maxlength:120},
 eventCity:{type:String,required:true,trim:true,maxlength:80},
 eventDate:{type:Date,required:true},
 currentRegistration:{type:Number,default:0,min:0,validate:Number.isSafeInteger},
 isActive:{type:Boolean,default:true}
},{timestamps:true}));
const Payment=mongoose.model('Payment',new mongoose.Schema({
 name:{type:String,required:true,trim:true,maxlength:120},
 registrationNumber:String,
 eventId:{type:mongoose.Schema.Types.ObjectId,ref:'Event',required:true},
 eventCity:{type:String,required:true}, eventName:String,eventDate:Date,
 registrationCount:{type:Number,required:true,min:1},
 amountPaise:{type:Number,required:true,min:1,validate:Number.isSafeInteger},
 photo:{url:String,publicId:String}
},{timestamps:true}));
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const validId=id=>mongoose.isValidObjectId(id);
function eventFields(body,partial=false){
 const out={};
 for(const k of ['eventName','eventCity']) if(!partial||k in body){if(typeof body[k]!=='string'||!body[k].trim())throw fail(400,k+' is required');out[k]=body[k].trim();}
 if(!partial||'eventDate' in body){const s=body.eventDate;const d=new Date(s);if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw fail(400,'Enter a valid event date');out.eventDate=d;}
 if('currentRegistration' in body){if(!Number.isSafeInteger(body.currentRegistration)||body.currentRegistration<0)throw fail(400,'Registration count must be a nonnegative integer');out.currentRegistration=body.currentRegistration;}
 if('isActive' in body){if(typeof body.isActive!=='boolean')throw fail(400,'Invalid status');out.isActive=body.isActive;}
 return out;
}
app.get('/',(req,res)=>res.json({success:true,message:'JFW backend running'}));
app.get('/api/health',(req,res)=>res.status(mongoose.connection.readyState===1?200:503).json({database:mongoose.connection.readyState===1?'Connected':'Disconnected'}));
app.get('/api/events',route(async(req,res)=>res.json(await Event.find().sort({eventDate:1}).lean())));
app.get('/api/events/active',route(async(req,res)=>res.json(await Event.find({isActive:true}).sort({eventDate:1}).lean())));
app.post('/api/events',route(async(req,res)=>{const event=await Event.create(eventFields(req.body));io.emit('events:changed');res.status(201).json(event);}));
app.get('/api/events/:id',route(async(req,res)=>{if(!validId(req.params.id))throw fail(400,'Invalid event ID');const event=await Event.findById(req.params.id);if(!event)throw fail(404,'Event not found');res.json(event);}));
app.patch('/api/events/:id',route(async(req,res)=>{if(!validId(req.params.id))throw fail(400,'Invalid event ID');const event=await Event.findByIdAndUpdate(req.params.id,{$set:eventFields(req.body,true)},{new:true,runValidators:true});if(!event)throw fail(404,'Event not found');io.emit('events:changed');res.json(event);}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024},fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype))});
app.post('/api/payments',upload.single('photo'),route(async(req,res)=>{
 const {name,eventId,amount}=req.body;const paise=Math.round(Number(amount)*100);
 if(typeof name!=='string'||!name.trim()||name.length>120||!validId(eventId)||!/^\d+(\.\d{1,2})?$/.test(amount||'')||!Number.isSafeInteger(paise)||paise<1||!req.file)throw fail(400,'Enter valid payment details and photo');
 if(!await Event.exists({_id:eventId,isActive:true}))throw fail(400,'Select an active event');
 let asset,payment,updatedEvent,committed=false;
 try{
 asset=await new Promise((resolve,reject)=>cloudinary.uploader.upload_stream({folder:'jfw-payments',resource_type:'image',transformation:[{width:800,height:800,crop:'limit'}]},(err,result)=>err?reject(err):resolve(result)).end(req.file.buffer));
 await mongoose.connection.transaction(async session=>{
 updatedEvent=await Event.findOneAndUpdate({_id:eventId,isActive:true,currentRegistration:{$lt:Number.MAX_SAFE_INTEGER}},{$inc:{currentRegistration:1}},{new:true,session});
 if(!updatedEvent)throw fail(409,'Event unavailable or registration limit reached');
 [payment]=await Payment.create([{name:name.trim(),eventId,eventCity:updatedEvent.eventCity,eventName:updatedEvent.eventName,eventDate:updatedEvent.eventDate,registrationCount:updatedEvent.currentRegistration,amountPaise:paise,photo:{url:asset.secure_url,publicId:asset.public_id}}],{session});
 }); committed=true;
 io.emit('payment:created',payment);io.emit('event:updated',updatedEvent);res.status(201).json(payment);
 }catch(err){if(asset&&!committed&&!err.hasErrorLabel?.('UnknownTransactionCommitResult'))await cloudinary.uploader.destroy(asset.public_id).catch(console.error);throw err;}
}));
app.get('/api/payments',route(async(req,res)=>res.json(await Payment.find().sort({createdAt:-1}).limit(200).lean())));
const Emergency=mongoose.model('Emergency',new mongoose.Schema({
 name:{type:String,required:true,trim:true,maxlength:120},
 reason:{type:String,required:true,trim:true,maxlength:500},
 photo:{url:String,publicId:String},
 status:{type:String,enum:['Active','Resolved'],default:'Active'},
 resolvedAt:{type:Date,default:null}
},{timestamps:true}));
app.get('/api/emergencies/active',route(async(req,res)=>res.json(await Emergency.find({status:'Active'}).sort({createdAt:1}).lean())));
app.get('/api/emergencies',route(async(req,res)=>res.json(await Emergency.find().sort({createdAt:-1}).limit(200).lean())));
app.post('/api/emergencies',upload.single('photo'),route(async(req,res)=>{
 const {name,reason}=req.body;
 if(typeof name!=='string'||!name.trim()||name.length>120||typeof reason!=='string'||!reason.trim()||reason.length>500||!req.file)throw fail(400,'Name, reason and photo are required');
 let asset, emergency;
 try{
 asset=await new Promise((resolve,reject)=>cloudinary.uploader.upload_stream({folder:'jfw-emergencies',resource_type:'image',transformation:[{width:800,height:800,crop:'limit'}]},(err,result)=>err?reject(err):resolve(result)).end(req.file.buffer));
 emergency=await Emergency.create({name,reason,photo:{url:asset.secure_url,publicId:asset.public_id}});
 }catch(err){if(asset&&!emergency)await cloudinary.uploader.destroy(asset.public_id).catch(console.error);throw err;}
 io.emit('emergency:created',{id:emergency._id});res.status(201).json(emergency);
}));
app.patch('/api/emergencies/:id/resolve',route(async(req,res)=>{
 if(!validId(req.params.id))throw fail(400,'Invalid emergency ID');
 const emergency=await Emergency.findOneAndUpdate({_id:req.params.id,status:'Active'},{$set:{status:'Resolved',resolvedAt:new Date()}},{new:true});
 if(!emergency)throw fail(404,'Active emergency not found');
 io.emit('emergency:resolved',{id:emergency._id});res.json(emergency);
}));
app.use((err,req,res,next)=>{console.error(err);if(res.headersSent)return next(err);const status=err.status||((err instanceof multer.MulterError||err instanceof mongoose.Error.ValidationError)?400:500);res.status(status).json({message:status===500?'Unable to complete request':err.message});});
io.on('connection',socket=>console.log('Display connected:',socket.id));
await mongoose.connect(MONGO_URI);await Promise.all([Event.init(),Payment.init(),Emergency.init()]);server.listen(PORT,'0.0.0.0',()=>console.log('JFW running on',PORT,'Allowed origins:',origins));
