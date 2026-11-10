import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose, { Schema } from 'mongoose';
import { startRabbit } from './rabbit';
import puppeteer from 'puppeteer';

const app = express(); app.use(cors()); app.use(express.json());
const scope = process.env.SERVICE_SCOPE || 'all';
const scopePrefixes: Record<string, string[]> = { auth: ['/auth', '/users', '/notifications', '/announcements', '/health'], workers: ['/workers', '/tasks', '/availability', '/cargos', '/health'], shifts: ['/shifts', '/schedules', '/dashboard', '/demo', '/restrictions', '/health'], reports: ['/reports', '/health'] };
app.use((req, res, next) => { if (scope === 'all' || (scopePrefixes[scope] || []).some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`))) return next(); res.status(404).json({ message: 'Este endpoint pertence a outro serviço.' }); });
const secret = process.env.JWT_SECRET || 'development-only-secret';
type Role = 'ADMIN' | 'WORKER';
interface AuthRequest extends Request { user?: { id: string; role: Role }; }
const User = mongoose.model('User', new Schema({ name: String, email: { type: String, unique: true }, passwordHash: String, role: { type: String, enum: ['ADMIN','WORKER'], default: 'WORKER' }, active: { type: Boolean, default: true }, deletedAt: Date }, { timestamps: true }));
const Worker = mongoose.model('Worker', new Schema({ userId: { type: String, unique: true, sparse: true }, name: { type: String, required: true }, email: String, phone: String, department: String, cargoIds: { type: [String], default: [] }, maxWeeklyHours: { type: Number, default: 40 }, maxMonthlyHours: { type: Number, default: 160 }, maxYearlyHours: { type: Number, default: 1920 } }, { timestamps: true }));
const Task = mongoose.model('Task', new Schema({ title: { type: String, required: true }, description: String, department: String, estimatedHours: Number, priority: { type: String, default: 'NORMAL' }, status: { type: String, default: 'PENDING' }, requiredCargoIds: { type: [String], default: [] } }, { timestamps: true }));
// RF03 / diagrama de classes: catálogo de cargos, referenciado por Worker.cargoIds e Task.requiredCargoIds.
const Cargo = mongoose.model('Cargo', new Schema({ name: { type: String, required: true, unique: true }, description: String }, { timestamps: true }));
// RF06 / diagrama de classes: restrições configuráveis. workerId vazio ('') = regra global.
// Se não existir registo para um tipo, usam-se os valores por defeito (campos do Worker / 11h de descanso).
const Restriction = mongoose.model('Restriction', new Schema({ type: { type: String, enum: ['MAX_WEEKLY_HOURS','MAX_MONTHLY_HOURS','MAX_YEARLY_HOURS','MIN_REST_HOURS'], required: true }, value: { type: Number, required: true }, workerId: { type: String, default: '' } }, { timestamps: true }));
const Availability = mongoose.model('Availability', new Schema({ workerId: String, start: Date, end: Date, type: { type: String, default: 'UNAVAILABLE' }, reason: String }));
const Shift = mongoose.model('Shift', new Schema({ workerId: { type: String, required: true }, taskId: String, start: { type: Date, required: true }, end: { type: Date, required: true }, type: { type: String, default: 'SHIFT' }, notes: String, recurrenceId: String, published: { type: Boolean, default: false }, status: { type: String, enum: ['ACTIVE','CANCELLED'], default: 'ACTIVE' } }, { timestamps: true }));
const Schedule = mongoose.model('Schedule', new Schema({ workerId: String, taskId: String, type: { type: String, default: 'SHIFT' }, startDate: Date, endDate: Date, daysOfWeek: [Number], startTime: String, endTime: String, notes: String, active: { type: Boolean, default: true } }, { timestamps: true }));
const Notification = mongoose.model('Notification', new Schema({ userId: String, workerId: String, type: String, message: String, read: { type: Boolean, default: false } }, { timestamps: true }));
const Announcement = mongoose.model('Announcement', new Schema({ title: { type: String, required: true }, body: { type: String, required: true }, authorId: String, audience: { type: String, default: 'ALL' }, status: { type: String, enum: ['DRAFT','PUBLISHED'], default: 'DRAFT' }, publishedAt: Date }, { timestamps: true }));
// Registo de relatórios gerados (RF07 / histórico) — uma linha por cada PDF emitido.
const Report = mongoose.model('Report', new Schema({ from: Date, to: Date, generatedBy: String, workerId: String, totalHours: Number }, { timestamps: true }));
let rabbit: ReturnType<typeof startRabbit> | null = null;
async function publishEvent(type: string, payload: Record<string, unknown>) {
  try { rabbit?.publish({ type, occurredAt: new Date().toISOString(), payload }); } catch (error) { console.warn('Não foi possível publicar evento RabbitMQ.', error); }
}
async function notifyWorker(workerId: string, type: string, message: string) {
  const worker = await Worker.findById(workerId);
  const notification = await Notification.create({ workerId, userId: worker?.get('userId'), type, message });
  await publishEvent(type, { notificationId: notification.id, workerId, message });
}

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) { try { const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) throw Error(); req.user = jwt.verify(token, secret) as {id:string;role:Role}; next(); } catch { res.status(401).json({ message: 'Não autenticado.' }); } }
function admin(req: AuthRequest, res: Response, next: NextFunction) { if (req.user?.role !== 'ADMIN') return res.status(403).json({ message: 'Acesso reservado a administradores.' }); next(); }
const asyncRoute = (fn: (req: AuthRequest,res:Response)=>Promise<unknown>) => (req: AuthRequest,res:Response) => fn(req,res).catch(e => res.status(400).json({ message: e.message || 'Pedido inválido.' }));

app.get('/health', (_, res) => res.json({ status: 'ok' }));
async function createAccount(payload: any, allowAdmin = false) { const { name, email, password, role = 'WORKER', phone = '', department = '', cargoIds = [] } = payload; if (!name || !email || !password) throw Error('Nome, email e palavra-passe são obrigatórios.'); const users = await User.countDocuments(); const actualRole: Role = (allowAdmin || users === 0) && role === 'ADMIN' ? 'ADMIN' : 'WORKER'; const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role: actualRole }); if (actualRole === 'WORKER') await Worker.create({ userId: user.id, name, email, phone, department, cargoIds: Array.isArray(cargoIds) ? cargoIds : [cargoIds].filter(Boolean) }); return user; }
app.post('/auth/register', asyncRoute(async (req,res) => { const user = await createAccount(req.body); res.status(201).json({id:user.id,name:user.get('name'),email:user.get('email'),role:user.get('role')}); }));
app.post('/auth/login', asyncRoute(async (req,res) => { const user=await User.findOne({email:req.body.email,active:true}); if (!user || !await bcrypt.compare(req.body.password,user.get('passwordHash'))) return res.status(401).json({message:'Credenciais inválidas.'}); const token=jwt.sign({id:user.id,role:user.get('role')},secret,{expiresIn:'8h'}); res.json({token,user:{id:user.id,name:user.get('name'),email:user.get('email'),role:user.get('role')}}); }));
app.get('/auth/me', requireAuth, asyncRoute(async (req,res) => res.json(await User.findById(req.user!.id).select('-passwordHash'))));
app.put('/auth/me', requireAuth, asyncRoute(async (req,res) => {
  const { name, email, phone } = req.body;
  if (!name || !email) throw Error('Nome e email são obrigatórios.');
  const user = await User.findByIdAndUpdate(req.user!.id, { name, email }, { new: true, runValidators: true }).select('-passwordHash');
  await Worker.updateOne({ userId: req.user!.id }, { $set: { name, email, phone } });
  res.json(user);
}));
app.get('/notifications', requireAuth, asyncRoute(async (req,res) => {
  const filter = req.user!.role === 'ADMIN' ? {} : { userId: req.user!.id };
  res.json(await Notification.find(filter).sort({ createdAt: -1 }).limit(30));
}));
app.patch('/notifications/:id/read', requireAuth, asyncRoute(async (req,res) => res.json(await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true }))));
/**
 * Módulo de Avisos/Notícias — a componente de gestão de conteúdo (CMS) da
 * aplicação. Ao contrário de um CMS genérico (que gere conteúdo arbitrário
 * sem regras de domínio), este módulo é propositadamente pequeno e focado:
 * o Administrador redige um aviso (rascunho), pode editá-lo, e só quando o
 * publica é que os trabalhadores o veem e são notificados. Um Funcionário
 * vê apenas avisos PUBLICADOS destinados a "ALL" ou ao seu departamento.
 */
app.get('/announcements', requireAuth, asyncRoute(async (req,res) => {
  if (req.user!.role === 'ADMIN') return res.json(await Announcement.find().sort({createdAt:-1}));
  const worker = await Worker.findOne({ userId: req.user!.id });
  const published = await Announcement.find({ status: 'PUBLISHED' }).sort({ publishedAt: -1 });
  res.json(published.filter(a => a.get('audience') === 'ALL' || a.get('audience') === worker?.get('department')));
}));
app.post('/announcements', requireAuth, admin, asyncRoute(async (req,res) => {
  const { title, body, audience = 'ALL' } = req.body;
  if (!title || !body) throw Error('Título e conteúdo são obrigatórios.');
  res.status(201).json(await Announcement.create({ title, body, audience, authorId: req.user!.id }));
}));
app.put('/announcements/:id', requireAuth, admin, asyncRoute(async (req,res) => {
  const { title, body, audience } = req.body;
  res.json(await Announcement.findByIdAndUpdate(req.params.id, { title, body, audience }, { new: true, runValidators: true }));
}));
app.delete('/announcements/:id', requireAuth, admin, asyncRoute(async (req,res) => { await Announcement.findByIdAndDelete(req.params.id); res.status(204).end(); }));
app.patch('/announcements/:id/publish', requireAuth, admin, asyncRoute(async (req,res) => {
  const announcement = await Announcement.findByIdAndUpdate(req.params.id, { status: 'PUBLISHED', publishedAt: new Date() }, { new: true });
  if (!announcement) throw Error('Aviso não encontrado.');
  const audience = announcement.get('audience');
  const workers = await Worker.find(audience === 'ALL' ? {} : { department: audience });
  for (const worker of workers) await notifyWorker(worker.id, 'ANNOUNCEMENT_PUBLISHED', `Novo aviso: ${announcement.get('title')}`);
  res.json(announcement);
}));
app.patch('/announcements/:id/unpublish', requireAuth, admin, asyncRoute(async (req,res) => res.json(await Announcement.findByIdAndUpdate(req.params.id, { status: 'DRAFT' }, { new: true }))));

app.get('/users', requireAuth, admin, asyncRoute(async (_,res) => res.json(await User.find({ deletedAt: null }).select('-passwordHash').sort({createdAt:-1}))));
app.post('/users', requireAuth, admin, asyncRoute(async (req,res) => { const user = await createAccount(req.body, true); res.status(201).json(user.toObject({ versionKey:false })); }));
app.put('/users/:id', requireAuth, admin, asyncRoute(async (req,res) => {
  const { name, email, role, phone, department } = req.body;
  if (!name || !email) throw Error('Nome e email são obrigatórios.');
  const user = await User.findByIdAndUpdate(req.params.id, { name, email, ...(role ? { role } : {}) }, { new: true, runValidators: true }).select('-passwordHash');
  if (!user) throw Error('Utilizador não encontrado.');
  await Worker.updateOne({ userId: req.params.id }, { $set: { name, email, phone, department } });
  res.json(user);
}));
app.patch('/users/:id/status', requireAuth, admin, asyncRoute(async (req,res) => res.json(await User.findByIdAndUpdate(req.params.id, {active: Boolean(req.body.active)}, {new:true}).select('-passwordHash'))));
app.delete('/users/:id', requireAuth, admin, asyncRoute(async (req,res) => {
  if (req.params.id === req.user!.id) throw Error('Não pode eliminar a sua própria conta.');
  // Soft delete (3.4.11): preserva o histórico, cancela e notifica turnos futuros, bloqueia login.
  const worker = await Worker.findOne({ userId: req.params.id });
  if (worker) {
    const futureShifts = await Shift.find({ workerId: worker.id, start: { $gt: new Date() }, status: { $ne: 'CANCELLED' } });
    for (const shift of futureShifts) {
      shift.set('status', 'CANCELLED');
      await shift.save();
      await notifyWorker(worker.id, 'SHIFT_CANCELLED', `O turno de ${shift.get('start').toLocaleString('pt-PT')} foi cancelado (conta eliminada).`);
    }
  }
  const user = await User.findByIdAndUpdate(req.params.id, { active: false, deletedAt: new Date() }, { new: true });
  if (!user) throw Error('Utilizador não encontrado.');
  res.json({ message: 'Conta eliminada. O histórico foi preservado.' });
}));

const resources: Array<[string, any]> = [['tasks', Task]];
for (const [path, Model] of resources) { app.get(`/${path}`, requireAuth, asyncRoute(async (_,res)=>res.json(await Model.find()))); app.post(`/${path}`, requireAuth, admin, asyncRoute(async (req,res)=>res.status(201).json(await Model.create(req.body)))); app.put(`/${path}/:id`, requireAuth, admin, asyncRoute(async (req,res)=>res.json(await Model.findByIdAndUpdate(req.params.id,req.body,{new:true})))); app.delete(`/${path}/:id`, requireAuth, admin, asyncRoute(async (req,res)=>{await Model.findByIdAndDelete(req.params.id);res.status(204).end();})); }

/**
 * Workers: separado do loop genérico acima porque DELETE precisa de cancelar
 * e notificar turnos futuros antes de remover o registo — em paridade com
 * DELETE /users/:id (3.4.11). Note-se a assimetria residual: ao contrário de
 * User, Worker não tem campo de soft delete próprio, pelo que o registo é
 * mesmo removido (hard delete) após essa proteção — ver 6.3.
 */
app.get('/workers', requireAuth, asyncRoute(async (_,res) => res.json(await Worker.find())));
app.post('/workers', requireAuth, admin, asyncRoute(async (req,res) => res.status(201).json(await Worker.create(req.body))));
app.put('/workers/:id', requireAuth, admin, asyncRoute(async (req,res) => res.json(await Worker.findByIdAndUpdate(req.params.id, req.body, { new: true }))));
app.delete('/workers/:id', requireAuth, admin, asyncRoute(async (req,res) => {
  const worker = await Worker.findById(req.params.id);
  if (!worker) return res.status(204).end();
  const futureShifts = await Shift.find({ workerId: worker.id, start: { $gt: new Date() }, status: { $ne: 'CANCELLED' } });
  for (const shift of futureShifts) {
    shift.set('status', 'CANCELLED');
    await shift.save();
    await notifyWorker(worker.id, 'SHIFT_CANCELLED', `O turno de ${shift.get('start').toLocaleString('pt-PT')} foi cancelado (ficha de trabalhador eliminada).`);
  }
  await worker.deleteOne();
  res.status(204).end();
}));

/**
 * Cargos (RF03 / diagrama de classes / caso de uso 3.4.13). Implementado à
 * parte do loop genérico de `resources` acima porque tem duas regras de
 * negócio próprias que o relatório exige explicitamente: nomes duplicados
 * são bloqueados, e não se elimina um cargo em uso por trabalhadores ou
 * tarefas (protege a integridade de cargoIds/requiredCargoIds).
 */
app.get('/cargos', requireAuth, asyncRoute(async (_,res) => res.json(await Cargo.find().sort({name:1}))));
app.post('/cargos', requireAuth, admin, asyncRoute(async (req,res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw Error('O nome do cargo é obrigatório.');
  if (await Cargo.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) throw Error('Já existe um cargo com esse nome.');
  res.status(201).json(await Cargo.create({ name, description: req.body.description }));
}));
app.put('/cargos/:id', requireAuth, admin, asyncRoute(async (req,res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw Error('O nome do cargo é obrigatório.');
  if (await Cargo.findOne({ _id: { $ne: req.params.id }, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) throw Error('Já existe um cargo com esse nome.');
  res.json(await Cargo.findByIdAndUpdate(req.params.id, { name, description: req.body.description }, { new: true }));
}));
app.delete('/cargos/:id', requireAuth, admin, asyncRoute(async (req,res) => {
  const [workerCount, taskCount] = await Promise.all([Worker.countDocuments({ cargoIds: req.params.id }), Task.countDocuments({ requiredCargoIds: req.params.id })]);
  if (workerCount || taskCount) throw Error(`Não é possível eliminar: cargo associado a ${workerCount} trabalhador(es) e ${taskCount} tarefa(s).`);
  await Cargo.findByIdAndDelete(req.params.id);
  res.status(204).end();
}));

/**
 * Restrições configuráveis (RF06 / diagrama de classes, entidade Restrição).
 * Uma regra sem `workerId` é global (aplica-se a todos); uma regra com
 * `workerId` sobrepõe-se à global só para esse trabalhador. Sem nenhum
 * registo, aplicam-se os valores por defeito (11h de descanso; limites do
 * perfil do trabalhador) — ver resolveRestriction, usado por validateShift.
 */
const RESTRICTION_TYPES = ['MAX_WEEKLY_HOURS','MAX_MONTHLY_HOURS','MAX_YEARLY_HOURS','MIN_REST_HOURS'];
app.get('/restrictions', requireAuth, admin, asyncRoute(async (_,res) => res.json(await Restriction.find().sort({createdAt:-1}))));
app.post('/restrictions', requireAuth, admin, asyncRoute(async (req,res) => {
  const { type, workerId = '' } = req.body;
  const value = Number(req.body.value);
  if (!RESTRICTION_TYPES.includes(type)) throw Error('Tipo de restrição inválido.');
  if (!(value > 0)) throw Error('O valor tem de ser um número positivo.');
  if (await Restriction.findOne({ type, workerId })) throw Error('Já existe uma restrição deste tipo para este âmbito — edite-a em vez de duplicar.');
  res.status(201).json(await Restriction.create({ type, value, workerId }));
}));
app.put('/restrictions/:id', requireAuth, admin, asyncRoute(async (req,res) => {
  const value = Number(req.body.value);
  if (!(value > 0)) throw Error('O valor tem de ser um número positivo.');
  res.json(await Restriction.findByIdAndUpdate(req.params.id, { value }, { new: true }));
}));
app.delete('/restrictions/:id', requireAuth, admin, asyncRoute(async (req,res) => { await Restriction.findByIdAndDelete(req.params.id); res.status(204).end(); }));
async function resolveRestriction(type: string, workerId: string, fallback: number): Promise<number> {
  const specific = await Restriction.findOne({ type, workerId });
  if (specific) return specific.get('value');
  const global = await Restriction.findOne({ type, workerId: '' });
  if (global) return global.get('value');
  return fallback;
}
async function ownWorkerId(userId: string) { const worker = await Worker.findOne({ userId }); if (!worker) throw Error('A conta não está associada a um trabalhador.'); return worker.id; }
app.get('/availability', requireAuth, asyncRoute(async (req,res) => { const filter = req.user!.role === 'ADMIN' ? {} : { workerId: await ownWorkerId(req.user!.id) }; res.json(await Availability.find(filter).sort({start:1})); }));
app.post('/availability', requireAuth, asyncRoute(async (req,res) => { const workerId = req.user!.role === 'ADMIN' ? req.body.workerId : await ownWorkerId(req.user!.id); if (!workerId || !req.body.start || !req.body.end) throw Error('Trabalhador, início e fim são obrigatórios.'); res.status(201).json(await Availability.create({...req.body, workerId})); }));
app.put('/availability/:id', requireAuth, asyncRoute(async (req,res) => { const item=await Availability.findById(req.params.id); if(!item) throw Error('Disponibilidade não encontrada.'); if(req.user!.role !== 'ADMIN' && item.get('workerId') !== await ownWorkerId(req.user!.id)) throw Error('Sem permissão para alterar este registo.'); res.json(await Availability.findByIdAndUpdate(req.params.id,req.body,{new:true})); }));
app.delete('/availability/:id', requireAuth, asyncRoute(async (req,res) => { const item=await Availability.findById(req.params.id); if(!item) throw Error('Disponibilidade não encontrada.'); if(req.user!.role !== 'ADMIN' && item.get('workerId') !== await ownWorkerId(req.user!.id)) throw Error('Sem permissão para eliminar este registo.'); await item.deleteOne(); res.status(204).end(); }));

async function validateShift(workerId: string, start: Date, end: Date, ignoreId?: string, taskId?: string) {
  if (end <= start) throw Error('A data de fim tem de ser posterior à de início.');
  const existing = await Shift.find({ workerId, _id: { $ne: ignoreId }, status: { $ne: 'CANCELLED' }, start: { $lt: end }, end: { $gt: start } });
  if (existing.length) throw Error('O trabalhador já possui um turno sobreposto.');
  if (await Availability.findOne({ workerId, start: { $lt: end }, end: { $gt: start } })) throw Error('O trabalhador está indisponível neste período.');
  const worker = await Worker.findById(workerId);
  if (!worker) throw Error('Trabalhador não encontrado.');
  if (taskId) {
    const task = await Task.findById(taskId);
    if (!task) throw Error('Tarefa não encontrada.');
    const required = task.get('requiredCargoIds') as string[];
    const cargoIds = worker.get('cargoIds') as string[];
    if (required?.length) {
      const missing = required.filter(id => !cargoIds.includes(id));
      if (missing.length) { const names = (await Cargo.find({ _id: { $in: missing } })).map(c => c.get('name')); throw Error(`O trabalhador não possui os cargos exigidos: ${names.join(', ') || missing.join(', ')}.`); }
    }
  }
  const restHours = await resolveRestriction('MIN_REST_HOURS', workerId, 11);
  const nearby = await Shift.find({ workerId, _id: { $ne: ignoreId }, status: { $ne: 'CANCELLED' }, $or: [{ end: { $lte: start } }, { start: { $gte: end } }] });
  for (const shift of nearby) {
    const gap = Math.min(Math.abs(start.getTime() - shift.get('end').getTime()), Math.abs(shift.get('start').getTime() - end.getTime())) / 36e5;
    if (gap < restHours) throw Error(`É obrigatório um descanso mínimo de ${restHours} horas.`);
  }
  const duration = (end.getTime() - start.getTime()) / 36e5;
  const periodHours = async (periodStart: Date) => (await Shift.find({ workerId, _id: { $ne: ignoreId }, status: { $ne: 'CANCELLED' }, start: { $gte: periodStart } })).reduce((total, shift) => total + (shift.get('end').getTime() - shift.get('start').getTime()) / 36e5, 0);
  const weekStart = new Date(start); weekStart.setDate(start.getDate() - start.getDay()); weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const yearStart = new Date(start.getFullYear(), 0, 1);
  const [maxWeekly, maxMonthly, maxYearly] = await Promise.all([
    resolveRestriction('MAX_WEEKLY_HOURS', workerId, worker.get('maxWeeklyHours')),
    resolveRestriction('MAX_MONTHLY_HOURS', workerId, worker.get('maxMonthlyHours')),
    resolveRestriction('MAX_YEARLY_HOURS', workerId, worker.get('maxYearlyHours')),
  ]);
  if (await periodHours(weekStart) + duration > maxWeekly) throw Error(`Ultrapassa o limite semanal de horas (${maxWeekly}h).`);
  if (await periodHours(monthStart) + duration > maxMonthly) throw Error(`Ultrapassa o limite mensal de horas (${maxMonthly}h).`);
  if (await periodHours(yearStart) + duration > maxYearly) throw Error(`Ultrapassa o limite anual de horas (${maxYearly}h).`);
}
app.get('/shifts', requireAuth, asyncRoute(async (req,res)=>{ 
  const filter: Record<string, unknown> = req.user!.role==='ADMIN'
    ? {}
    : { workerId: (await Worker.findOne({userId:req.user!.id}))?._id, published: true };
  if (!req.query.includeCancelled) filter.status = { $ne: 'CANCELLED' };
  if (req.query.from || req.query.to) filter.start = { ...(req.query.from ? {$gte:new Date(String(req.query.from))} : {}), ...(req.query.to ? {$lte:new Date(String(req.query.to))} : {}) };
  res.json(await Shift.find(filter).sort({start:1}));
}));
app.post('/shifts', requireAuth, admin, asyncRoute(async (req,res)=>{const {workerId,start,end,taskId,type='SHIFT'}=req.body;if(type==='VACATION') throw Error('Registe férias em Disponibilidades.');await validateShift(workerId,new Date(start),new Date(end),undefined,taskId);const shift=await Shift.create(req.body);await notifyWorker(workerId, 'SHIFT_CREATED', `Foi-lhe atribuído um evento ${type} em ${new Date(start).toLocaleString('pt-PT')}.`);res.status(201).json(shift);}));
app.put('/shifts/:id', requireAuth, admin, asyncRoute(async (req,res)=>{const {workerId,start,end,taskId}=req.body;await validateShift(workerId,new Date(start),new Date(end),req.params.id,taskId);const shift=await Shift.findByIdAndUpdate(req.params.id,req.body,{new:true});await notifyWorker(workerId, 'SHIFT_UPDATED', `O seu turno de ${new Date(start).toLocaleString('pt-PT')} foi atualizado.`);res.json(shift);}));
app.patch('/shifts/:id/publish', requireAuth, admin, asyncRoute(async (req,res)=>{const shift=await Shift.findByIdAndUpdate(req.params.id,{published:true},{new:true});if(!shift)throw Error('Turno não encontrado.');await notifyWorker(shift.get('workerId'), 'SHIFT_PUBLISHED', `Um turno foi publicado para ${shift.get('start').toLocaleString('pt-PT')}.`);res.json(shift);}));
app.post('/shifts/publish', requireAuth, admin, asyncRoute(async (req,res)=>{ const ids = Array.isArray(req.body.ids) ? req.body.ids : []; const shifts = await Shift.find({_id:{$in:ids},published:false}); for (const shift of shifts) { shift.set('published',true); await shift.save(); await notifyWorker(shift.get('workerId'),'SHIFT_PUBLISHED',`Um turno foi publicado para ${shift.get('start').toLocaleString('pt-PT')}.`); } res.json({published:shifts.length}); }));
app.delete('/shifts/:id', requireAuth, admin, asyncRoute(async (req,res)=>{
  const shift = await Shift.findById(req.params.id);
  if (!shift) return res.status(204).end();
  // 3.4.15: turnos passados (histórico) não se eliminam; turnos futuros ficam CANCELLED (soft), não são apagados.
  if (shift.get('start') < new Date()) throw Error('Não é possível eliminar um turno já decorrido — faz parte do histórico.');
  shift.set('status', 'CANCELLED');
  await shift.save();
  await notifyWorker(shift.get('workerId'), 'SHIFT_CANCELLED', `O turno de ${shift.get('start').toLocaleString('pt-PT')} foi cancelado.`);
  res.json(shift);
}));
app.post('/schedules', requireAuth, admin, asyncRoute(async (req,res) => { const { workerId, taskId, startDate, endDate, daysOfWeek, startTime, endTime, type = 'SHIFT', notes = '' } = req.body; if (!workerId || !startDate || !endDate || !Array.isArray(daysOfWeek) || !startTime || !endTime) throw Error('Preencha trabalhador, período, dias e horário.'); const schedule=await Schedule.create({workerId,taskId,startDate,endDate,daysOfWeek,startTime,endTime,type,notes}); const created:any[]=[], skipped:string[]=[]; const cursor=new Date(startDate); const end=new Date(endDate); while(cursor<=end){if(daysOfWeek.includes(cursor.getDay())){const [sh,sm]=startTime.split(':').map(Number),[eh,em]=endTime.split(':').map(Number);const start=new Date(cursor);start.setHours(sh,sm,0,0);const finish=new Date(cursor);finish.setHours(eh,em,0,0);try{await validateShift(workerId,start,finish,undefined,taskId);created.push(await Shift.create({workerId,taskId,start,end:finish,type,notes,recurrenceId:schedule.id}));}catch(e){skipped.push(`${cursor.toLocaleDateString('pt-PT')}: ${(e as Error).message}`)}}cursor.setDate(cursor.getDate()+1)} res.status(201).json({schedule,created,skipped}); }));
app.get('/schedules', requireAuth, admin, asyncRoute(async (_,res)=>res.json(await Schedule.find({active:true}).sort({startDate:-1}))));
app.get('/dashboard', requireAuth, asyncRoute(async (_,res) => {
  const [workers, tasks, assignments, shifts] = await Promise.all([
    Worker.find(),
    Task.countDocuments({ status: { $ne: 'DONE' } }),
    Schedule.countDocuments({ active: true }),
    Shift.countDocuments({ status: { $ne: 'CANCELLED' } }),
  ]);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
  const ratios = await Promise.all(workers.map(async worker => {
    const weekShifts = await Shift.find({ workerId: worker.id, status: { $ne: 'CANCELLED' }, start: { $gte: weekStart, $lt: weekEnd } });
    const hours = weekShifts.reduce((total, s) => total + (s.get('end').getTime() - s.get('start').getTime()) / 36e5, 0);
    return Math.min(hours / (worker.get('maxWeeklyHours') || 40), 1);
  }));
  const utilization = ratios.length ? Math.round((ratios.reduce((sum, r) => sum + r, 0) / ratios.length) * 100) : 0;
  res.json({ workers: workers.length, tasks, assignments, shifts, utilization });
}));
app.post('/demo/seed', requireAuth, admin, asyncRoute(async (_,res) => {
  if (await Worker.countDocuments() || await Task.countDocuments()) return res.json({ message: 'Já existem dados. A demonstração não foi alterada.' });
  const cargos = await Cargo.insertMany([
    { name: 'Operador de Armazém', description: 'Movimentação e conferência de stock.' },
    { name: 'Primeiros Socorros', description: 'Certificação para assistência básica em caso de acidente.' },
  ]);
  const workers = await Worker.insertMany([
    { name: 'Ana Martins', email: 'ana@shiftflow.demo', phone: '912 000 001', department: 'Operações', cargoIds: [cargos[0].id, cargos[1].id], maxWeeklyHours: 40, maxMonthlyHours: 160, maxYearlyHours: 1920 },
    { name: 'Bruno Silva', email: 'bruno@shiftflow.demo', phone: '912 000 002', department: 'Operações', cargoIds: [cargos[0].id], maxWeeklyHours: 40, maxMonthlyHours: 160, maxYearlyHours: 1920 },
    { name: 'Carla Santos', email: 'carla@shiftflow.demo', phone: '912 000 003', department: 'Logística', cargoIds: [], maxWeeklyHours: 32, maxMonthlyHours: 128, maxYearlyHours: 1536 }
  ]);
  const tasks = await Task.insertMany([
    { title: 'Abertura de turno', description: 'Preparação operacional do dia.', department: 'Operações', estimatedHours: 8, priority: 'HIGH', status: 'IN_PROGRESS', requiredCargoIds: [cargos[0].id] },
    { title: 'Inventário semanal', description: 'Conferência e atualização de inventário.', department: 'Logística', estimatedHours: 6, priority: 'NORMAL', status: 'PENDING' }
  ]);
  const day = new Date(); day.setDate(day.getDate() + 1); day.setHours(9, 0, 0, 0);
  for (const [index, worker] of workers.entries()) { const start = new Date(day); start.setDate(day.getDate() + index); const end = new Date(start); end.setHours(17, 0, 0, 0); await Shift.create({ workerId: worker.id, taskId: tasks[index % tasks.length].id, start, end, type: 'SHIFT', notes: 'Turno de demonstração', published: true }); }
  res.status(201).json({ message: 'Dados de demonstração criados (incluindo cargos).', workers: workers.length, tasks: tasks.length, shifts: workers.length, cargos: cargos.length });
}));

/**
 * Geração automática de escala — automação simples sobre o CRUD de turnos.
 *
 * Não é um motor de otimização à parte: para cada dia do período (filtrado por
 * daysOfWeek), esta rota limita-se a repetir, em ciclo (round-robin) pelos
 * trabalhadores selecionados, EXATAMENTE a mesma operação que o Administrador
 * faria manualmente em POST /shifts — incluindo a mesma função de validação
 * (validateShift). Isto é intencional: garante que um turno criado
 * automaticamente respeita sempre as mesmas regras que um turno criado à mão,
 * sem duplicar lógica de negócio (princípio DRY). Se o trabalhador da vez não
 * for elegível nesse dia, o dia fica em "skipped" para o Administrador tratar
 * manualmente (RF05.3).
 */
app.post('/shifts/generate', requireAuth, admin, asyncRoute(async (req,res) => {
  const { start, end, workerIds, taskId, startTime = '09:00', endTime = '17:00', daysOfWeek = [1,2,3,4,5], type = 'SHIFT' } = req.body;
  const from = new Date(start), until = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || until < from) throw Error('Indique um intervalo de datas válido.');
  until.setHours(23, 59, 59, 999);
  const workers = await Worker.find(workerIds?.length ? { _id: { $in: workerIds } } : {});
  if (!workers.length) throw Error('Selecione pelo menos um trabalhador.');
  const created: unknown[] = [], skipped: string[] = [];
  const day = new Date(from); day.setHours(9,0,0,0);
  while (day <= until) {
    if (daysOfWeek.includes(day.getDay())) {
      const worker = workers[(created.length + skipped.length) % workers.length];
      const shiftStart = new Date(day), shiftEnd = new Date(day); const [sh,sm]=startTime.split(':').map(Number),[eh,em]=endTime.split(':').map(Number); shiftStart.setHours(sh,sm,0,0); shiftEnd.setHours(eh,em,0,0);
      try { await validateShift(worker.id, shiftStart, shiftEnd, undefined, taskId); created.push(await Shift.create({workerId:worker.id, taskId, start:shiftStart, end:shiftEnd, type, notes:'Gerado automaticamente'})); }
      catch (e) { skipped.push(`${day.toLocaleDateString('pt-PT')}: ${(e as Error).message}`); }
    }
    day.setDate(day.getDate()+1);
  }
  res.status(201).json({ created, skipped, message: `${created.length} turnos gerados.` });
}));

app.get('/reports/hours', requireAuth, asyncRoute(async (req,res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(); to.setHours(23,59,59,999);
  const workerFilter = req.user!.role === 'ADMIN' ? (req.query.workerId ? {_id:String(req.query.workerId)} : {}) : {userId:req.user!.id};
  const workers = await Worker.find(workerFilter);
  const rows = await Promise.all(workers.map(async worker => {
    const shifts = await Shift.find({workerId:worker.id,status:{$ne:'CANCELLED'},start:{$gte:from,$lte:to}}).sort({start:1});
    const hours = shifts.reduce((total, s) => total + (s.get('end').getTime()-s.get('start').getTime())/36e5, 0);
    return { workerId:worker.id, name:worker.get('name'), department:worker.get('department'), hours, shifts:shifts.length };
  }));
  res.json({from,to,rows,totalHours:rows.reduce((t,r)=>t+r.hours,0)});
}));

app.get('/reports/history', requireAuth, admin, asyncRoute(async (_,res) => res.json(await Report.find().sort({createdAt:-1}).limit(50))));

app.get('/reports/hours.pdf', requireAuth, asyncRoute(async (req,res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(); to.setHours(23,59,59,999);
  const workerFilter = req.user!.role === 'ADMIN' ? (req.query.workerId ? {_id:String(req.query.workerId)} : {}) : {userId:req.user!.id};
  const workers = await Worker.find(workerFilter);
  const rows = await Promise.all(workers.map(async worker => { const shifts=await Shift.find({workerId:worker.id,status:{$ne:'CANCELLED'},start:{$gte:from,$lte:to}}); const hours=shifts.reduce((total,s)=>total+(s.get('end').getTime()-s.get('start').getTime())/36e5,0); return {name:worker.get('name'),department:worker.get('department') || '—', shifts:shifts.length,hours}; }));
  const total = rows.reduce((sum,row)=>sum+row.hours,0);
  // RF07 / diagrama de classes: fica registo de cada relatório gerado (quem, quando, período, total).
  await Report.create({ from, to, generatedBy: req.user!.id, workerId: req.user!.role === 'ADMIN' ? (req.query.workerId ? String(req.query.workerId) : undefined) : req.user!.id, totalHours: total });
  const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><style>body{font-family:Arial,sans-serif;color:#172033;padding:28px}h1{color:#312e81;margin-bottom:4px}p{color:#64748b}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{padding:10px;text-align:left;border-bottom:1px solid #ddd}th{background:#eef2ff}tfoot{font-weight:bold}.meta{font-size:12px}</style></head><body><h1>ShiftFlow - Relatório de horas</h1><p>Período: ${from.toLocaleDateString('pt-PT')} a ${to.toLocaleDateString('pt-PT')}</p><table><thead><tr><th>Trabalhador</th><th>Departamento</th><th>Turnos</th><th>Horas</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row.name}</td><td>${row.department}</td><td>${row.shifts}</td><td>${row.hours.toFixed(1)} h</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">Total</td><td>${total.toFixed(1)} h</td></tr></tfoot></table><p class="meta">Gerado em ${new Date().toLocaleString('pt-PT')} por ShiftFlow.</p></body></html>`);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' } });
    res.type('application/pdf').attachment(`shiftflow-horas-${from.toISOString().slice(0,10)}.pdf`).send(pdf);
  } finally { await browser.close(); }
}));

async function start() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/shiftflow');
  // Não bloqueia o arranque: repete a ligação ao broker até conseguir e religa-se se cair (ver rabbit.ts).
  rabbit = startRabbit({ url: process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672', queue: 'shiftflow.events' });
  app.listen(Number(process.env.PORT)||3000,()=>console.log('API pronta'));
}
start().catch(console.error);
