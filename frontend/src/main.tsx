import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./demo.css";
type User = { id: string; name: string; role: "ADMIN" | "WORKER"; email?: string; phone?: string };
const api = async (path: string, token?: string, init?: RequestInit) => {
  const r = await fetch("/api" + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Error(data?.message || "Erro no pedido");
  return data;
};
function Login({ onLogin }: { onLogin: (u: User, t: string) => void }) {
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const d = await api("/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({
          email: f.get("email"),
          password: f.get("password"),
        }),
      });
      onLogin(d.user, d.token);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="login">
      <section>
        <span className="brand">ShiftFlow</span>
        <h1>Gestão de turnos sem conflitos.</h1>
        <p>
          Planeie equipas, valide regras laborais e consulte escalas num único
          lugar.
        </p>
      </section>
      <form onSubmit={submit}>
        <h2>Entrar</h2>
        {error && <p className="error">{error}</p>}
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            placeholder="nome@empresa.pt"
          />
        </label>
        <label>
          Palavra-passe
          <input
            name="password"
            type="password"
            required
            placeholder="••••••••"
          />
        </label>
        <button>Iniciar sessão</button>
        <small>
          Crie o primeiro administrador através do endpoint{" "}
          <code>/api/auth/register</code>.
        </small>
      </form>
    </main>
  );
}
const dt = (v?: string) => v ? new Date(v).toISOString().slice(0, 16) : "";
const DEPARTMENTS = [
  "Administração", "Atendimento ao Cliente", "Comercial / Vendas", "Financeiro",
  "Logística", "Manutenção", "Marketing", "Operações", "Produção", "Qualidade",
  "Recursos Humanos", "Tecnologias de Informação", "Outro",
];
function DepartmentSelect({ defaultValue }: { defaultValue?: string }) {
  return <select name="department" defaultValue={defaultValue || ""}>
    <option value="">Selecionar…</option>
    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
  </select>;
}

function Crud({ kind, token, flash }: { kind: "workers"|"tasks"|"availability"|"cargos"; token: string; flash: (s:string, bad?:boolean)=>void }) {
  const [rows,setRows]=useState<any[]>([]),[edit,setEdit]=useState<any>(null),[open,setOpen]=useState(false),[workers,setWorkers]=useState<any[]>([]),[cargos,setCargos]=useState<any[]>([]);
  const load=()=>api(`/${kind}`,token).then(setRows).catch(e=>flash(e.message,true));
  useEffect(()=>{load();if(kind==="availability")api("/workers",token).then(setWorkers);if(kind==="workers"||kind==="tasks")api("/cargos",token).then(setCargos)},[kind]);
  const save=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const data=new FormData(e.currentTarget);const body:any=Object.fromEntries(data);for(const key of ["maxWeeklyHours","estimatedHours"])if(body[key])body[key]=Number(body[key]);if(kind==="workers")body.cargoIds=data.getAll("cargoIds");if(kind==="tasks")body.requiredCargoIds=data.getAll("requiredCargoIds");try{await api(`/${kind}${edit?`/${edit._id}`:""}`,token,{method:edit?"PUT":"POST",body:JSON.stringify(body)});flash(edit?"Registo atualizado.":"Registo criado.");setOpen(false);setEdit(null);load()}catch(x){flash((x as Error).message,true)}};
  const del=async(x:any)=>{if(!confirm("Eliminar este registo?"))return;try{await api(`/${kind}/${x._id}`,token,{method:"DELETE"});flash("Registo eliminado.");load()}catch(e){flash((e as Error).message,true)}};
  const name=(x:any)=>x.name||x.title||x.type;
  const cargoNames=(ids:string[])=>ids?.map(id=>cargos.find(c=>c._id===id)?.name).filter(Boolean).join(", ");
  const title=kind==="workers"?"Trabalhadores":kind==="tasks"?"Tarefas":kind==="cargos"?"Cargos":"Disponibilidades";
  return <section className="table"><div className="tablehead"><div><h2>{title}</h2><p>{rows.length} registo(s)</p></div><button className="primary" onClick={()=>{setEdit(null);setOpen(true)}}>+ Novo</button></div>{open&&<form className="editor" onSubmit={save}><h3>{edit?"Editar":"Novo"} registo</h3><div className="formgrid">{kind==="workers"?<><label>Nome<input name="name" required defaultValue={edit?.name}/></label><label>Email<input name="email" type="email" defaultValue={edit?.email}/></label><label>Telefone<input name="phone" defaultValue={edit?.phone}/></label><label>Departamento<DepartmentSelect defaultValue={edit?.department}/></label><label>Máximo semanal<input name="maxWeeklyHours" type="number" defaultValue={edit?.maxWeeklyHours||40}/></label><label className="wide">Cargos<select name="cargoIds" multiple size={4} defaultValue={edit?.cargoIds||[]}>{cargos.map(c=><option key={c._id} value={c._id}>{c.name}</option>)}</select></label><p className="hint">Ctrl/Cmd + clique para escolher mais do que um.</p></>:kind==="tasks"?<><label>Título<input name="title" required defaultValue={edit?.title}/></label><label>Departamento<DepartmentSelect defaultValue={edit?.department}/></label><label>Horas estimadas<input name="estimatedHours" type="number" defaultValue={edit?.estimatedHours}/></label><label>Prioridade<select name="priority" defaultValue={edit?.priority||"NORMAL"}><option>LOW</option><option>NORMAL</option><option>HIGH</option></select></label><label>Estado<select name="status" defaultValue={edit?.status||"PENDING"}><option>PENDING</option><option>IN_PROGRESS</option><option>DONE</option></select></label><label className="wide">Descrição<textarea name="description" defaultValue={edit?.description}/></label><label className="wide">Cargos exigidos<select name="requiredCargoIds" multiple size={4} defaultValue={edit?.requiredCargoIds||[]}>{cargos.map(c=><option key={c._id} value={c._id}>{c.name}</option>)}</select></label><p className="hint">Ctrl/Cmd + clique para escolher mais do que um.</p></>:kind==="cargos"?<><label>Nome<input name="name" required defaultValue={edit?.name}/></label><label className="wide">Descrição<textarea name="description" defaultValue={edit?.description}/></label></>:<><label>Trabalhador<select name="workerId" required defaultValue={edit?.workerId}><option value="">Selecionar…</option>{workers.map(w=><option key={w._id} value={w._id}>{w.name}</option>)}</select></label><label>Início<input name="start" type="datetime-local" required defaultValue={dt(edit?.start)}/></label><label>Fim<input name="end" type="datetime-local" required defaultValue={dt(edit?.end)}/></label><label>Tipo<select name="type" defaultValue={edit?.type||"UNAVAILABLE"}><option>UNAVAILABLE</option><option>VACATION</option><option>PREFERENCE</option></select></label><label className="wide">Motivo<textarea name="reason" defaultValue={edit?.reason}/></label></>}</div><div className="actions"><button type="button" onClick={()=>setOpen(false)}>Cancelar</button><button className="primary">Guardar</button></div></form>}<div className="records">{rows.length?rows.map(x=><article key={x._id}><div><strong>{name(x)}</strong><span>{kind==="availability"?`${workers.find(w=>w._id===x.workerId)?.name||""} · ${new Date(x.start).toLocaleString("pt-PT")} — ${new Date(x.end).toLocaleString("pt-PT")}`:kind==="cargos"?(x.description||"Sem descrição"):kind==="workers"?(cargoNames(x.cargoIds)||x.department||"Sem cargo atribuído"):kind==="tasks"?(cargoNames(x.requiredCargoIds)||x.department||x.status||"Sem detalhes"):x.department||x.status||"Sem detalhes"}</span></div><div className="actions"><button onClick={()=>{setEdit(x);setOpen(true)}}>Editar</button><button className="danger" onClick={()=>del(x)}>Eliminar</button></div></article>):<p className="empty">Ainda não existem registos.</p>}</div></section>;
}
function Shifts({token,user,flash}:{token:string;user:User;flash:(s:string,b?:boolean)=>void}){
  const isAdmin = user.role === "ADMIN";
  const [rows,setRows]=useState<any[]>([]),[workers,setWorkers]=useState<any[]>([]),[tasks,setTasks]=useState<any[]>([]),[edit,setEdit]=useState<any>(null),[open,setOpen]=useState(false),[anchor,setAnchor]=useState(new Date()),[view,setView]=useState<"week"|"month">("week"),[filterWorker,setFilterWorker]=useState(""),[filterTask,setFilterTask]=useState("");
  const load=()=>api("/shifts",token).then(setRows).catch(e=>flash(e.message,true));
  useEffect(()=>{load();if(isAdmin){api("/workers",token).then(setWorkers);api("/tasks",token).then(setTasks)}},[]);
  const days = view==="week"
    ? Array.from({length:7},(_,i)=>{const d=new Date(anchor);d.setDate(d.getDate()-((d.getDay()+6)%7)+i);return d})
    : Array.from({length:new Date(anchor.getFullYear(),anchor.getMonth()+1,0).getDate()},(_,i)=>new Date(anchor.getFullYear(),anchor.getMonth(),i+1));
  const navPrev=()=>setAnchor(d=>{const nd=new Date(d); view==="week"?nd.setDate(nd.getDate()-7):nd.setMonth(nd.getMonth()-1); return nd;});
  const navNext=()=>setAnchor(d=>{const nd=new Date(d); view==="week"?nd.setDate(nd.getDate()+7):nd.setMonth(nd.getMonth()+1); return nd;});
  const visibleRows = rows.filter(s => (!filterWorker||s.workerId===filterWorker) && (!filterTask||s.taskId===filterTask));
  const save=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();try{await api(`/shifts${edit?`/${edit._id}`:""}`,token,{method:edit?"PUT":"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});flash("Turno guardado e validado.");setOpen(false);load()}catch(x){flash((x as Error).message,true)}};
  const generate=async()=>{try{const r=await api("/shifts/generate",token,{method:"POST",body:JSON.stringify({start:days[0].toISOString(),end:days[days.length-1].toISOString(),workerIds:workers.map(w=>w._id),taskId:tasks[0]?._id})});flash(`${r.message}${r.skipped.length?` ${r.skipped.length} inválidos.`:""} Rascunhos por publicar.`);load()}catch(e){flash((e as Error).message,true)}};
  const publish=async(s:any)=>{try{await api(`/shifts/${s._id}/publish`,token,{method:"PATCH"});flash("Turno publicado.");load()}catch(e){flash((e as Error).message,true)}};
  const publishVisible=async()=>{const ids=visibleRows.filter(s=>!s.published && days.some(d=>new Date(s.start).toDateString()===d.toDateString())).map(s=>s._id);if(!ids.length)return flash("Não há turnos por publicar neste período.",true);try{const r=await api("/shifts/publish",token,{method:"POST",body:JSON.stringify({ids})});flash(`${r.published} turno(s) publicado(s).`);load()}catch(e){flash((e as Error).message,true)}};
  return <section className="table"><div className="tablehead"><div><h2>Calendário de turnos</h2><p>Conflitos, indisponibilidades e descanso mínimo são validados.</p></div><div className="actions">
    <button onClick={navPrev}>←</button><button onClick={()=>setAnchor(new Date())}>Hoje</button><button onClick={navNext}>→</button>
    <select value={view} onChange={e=>setView(e.target.value as "week"|"month")}><option value="week">Semana</option><option value="month">Mês</option></select>
    {isAdmin && <select value={filterWorker} onChange={e=>setFilterWorker(e.target.value)}><option value="">Todos os trabalhadores</option>{workers.map(w=><option key={w._id} value={w._id}>{w.name}</option>)}</select>}
    {isAdmin && <select value={filterTask} onChange={e=>setFilterTask(e.target.value)}><option value="">Todas as tarefas</option>{tasks.map(t=><option key={t._id} value={t._id}>{t.title}</option>)}</select>}
    {isAdmin && <><button onClick={generate}>Gerar {view==="week"?"semana":"mês"}</button><button onClick={publishVisible}>Publicar visíveis</button><button className="primary" onClick={()=>{setEdit(null);setOpen(true)}}>+ Turno</button></>}
  </div></div>
  {open&&<form className="editor" onSubmit={save}><h3>{edit?"Editar":"Novo"} turno</h3><div className="formgrid"><label>Trabalhador<select name="workerId" required defaultValue={edit?.workerId}><option value="">Selecionar…</option>{workers.map(w=><option key={w._id} value={w._id}>{w.name}</option>)}</select></label><label>Tarefa<select name="taskId" defaultValue={edit?.taskId}><option value="">Sem tarefa</option>{tasks.map(t=><option key={t._id} value={t._id}>{t.title}</option>)}</select></label><label>Início<input name="start" type="datetime-local" required defaultValue={dt(edit?.start)}/></label><label>Fim<input name="end" type="datetime-local" required defaultValue={dt(edit?.end)}/></label><label className="wide">Notas<textarea name="notes" defaultValue={edit?.notes}/></label></div><div className="actions"><button type="button" onClick={()=>setOpen(false)}>Cancelar</button><button className="primary">Guardar</button></div></form>}
  <div className="calendar">{days.map(d=><div className="day" key={d.toISOString()}><h3>{d.toLocaleDateString("pt-PT",{weekday:view==="week"?"short":undefined,day:"numeric",month:view==="month"?"short":undefined})}</h3>{visibleRows.filter(s=>new Date(s.start).toDateString()===d.toDateString()).map(s=><div className={`shift${s.published===false?" draft":""}`} key={s._id}><strong>{workers.find(w=>w._id===s.workerId)?.name||"Trabalhador"}</strong><span>{new Date(s.start).toLocaleTimeString("pt-PT",{hour:"2-digit",minute:"2-digit"})}–{new Date(s.end).toLocaleTimeString("pt-PT",{hour:"2-digit",minute:"2-digit"})}</span>{s.published===false&&<span className="badge">Rascunho</span>}{isAdmin&&<div className="actions"><button onClick={()=>{setEdit(s);setOpen(true)}}>Editar</button>{s.published===false&&<button onClick={()=>publish(s)}>Publicar</button>}</div>}</div>)}</div>)}</div>
  </section>;
}
function Reports({token,flash}:{token:string;flash:(s:string,b?:boolean)=>void}){const [r,setR]=useState<any>(null),[from,setFrom]=useState(new Date().toISOString().slice(0,7)+"-01"),[to,setTo]=useState(new Date().toISOString().slice(0,10));const load=()=>api(`/reports/hours?from=${from}&to=${to}`,token).then(setR).catch(e=>flash(e.message,true));useEffect(()=>{void load()},[]);return <section className="table report"><div className="tablehead"><div><h2>Relatório de horas</h2><p>Resumo por trabalhador.</p></div><button className="primary" onClick={()=>window.print()}>Imprimir / PDF</button></div><div className="actions filters"><label>De<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Até<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><button onClick={load}>Atualizar</button></div><table><thead><tr><th>Trabalhador</th><th>Departamento</th><th>Turnos</th><th>Horas</th></tr></thead><tbody>{r?.rows.map((x:any)=><tr><td>{x.name}</td><td>{x.department||"—"}</td><td>{x.shifts}</td><td>{x.hours.toFixed(1)} h</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>Total</td><td>{r?.totalHours?.toFixed(1)||"0.0"} h</td></tr></tfoot></table></section>}
function Profile({token,user,flash,setUser}:{token:string;user:User;flash:(s:string,b?:boolean)=>void;setUser:(u:User)=>void}){return <section className="table"><div className="tablehead"><h2>O meu perfil</h2></div><form className="editor" onSubmit={async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();try{const updated=await api("/auth/me",token,{method:"PUT",body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});localStorage.setItem("user",JSON.stringify(updated));setUser(updated);flash("Perfil atualizado.")}catch(x){flash((x as Error).message,true)}}}><div className="formgrid"><label>Nome<input name="name" defaultValue={user.name} required/></label><label>Email<input name="email" type="email" defaultValue={user.email} required/></label><label>Telefone<input name="phone" defaultValue={user.phone}/></label><label>Função<input value={user.role === "ADMIN" ? "Administrador" : "Trabalhador"} disabled/></label></div><button className="primary">Guardar perfil</button></form></section>}
function ReportsV2({ token, user, flash }: { token: string; user: User; flash: (s: string, b?: boolean) => void }) {
  const [rows, setRows] = useState<any[]>([]), [from, setFrom] = useState(new Date().toISOString().slice(0, 7) + "-01"), [to, setTo] = useState(new Date().toISOString().slice(0, 10)), [total, setTotal] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const load = () => api(`/reports/hours?from=${from}&to=${to}`, token).then(r => { setRows(r.rows); setTotal(r.totalHours); }).catch(e => flash(e.message, true));
  const loadHistory = () => { if (user.role === "ADMIN") api('/reports/history', token).then(setHistory).catch(() => {}); };
  useEffect(() => { void load(); loadHistory(); }, []);
  async function pdf() { try { const response = await fetch(`/api/reports/hours.pdf?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw Error('Não foi possível gerar o PDF.'); const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `shiftflow-horas-${from}.pdf`; link.click(); URL.revokeObjectURL(url); loadHistory(); } catch (e) { flash((e as Error).message, true); } }
  return <section className="table report"><div className="tablehead"><div><h2>Relatório de horas</h2><p>Pré-visualização e exportação oficial em PDF.</p></div><div className="actions"><button onClick={() => window.print()}>Imprimir</button><button className="primary" onClick={pdf}>Descarregar PDF</button></div></div><div className="actions filters"><label>De<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Até<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label><button onClick={load}>Atualizar</button></div><table><thead><tr><th>Trabalhador</th><th>Departamento</th><th>Turnos</th><th>Horas</th></tr></thead><tbody>{rows.map(row => <tr key={row.workerId}><td>{row.name}</td><td>{row.department || '—'}</td><td>{row.shifts}</td><td>{row.hours.toFixed(1)} h</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>Total</td><td>{total.toFixed(1)} h</td></tr></tfoot></table>
    {user.role === "ADMIN" && <div className="records"><h3>Histórico de relatórios gerados</h3>{history.length?history.map(h=><article key={h._id}><div><strong>{new Date(h.from).toLocaleDateString('pt-PT')} – {new Date(h.to).toLocaleDateString('pt-PT')}</strong><span>{h.totalHours?.toFixed(1)} h · gerado em {new Date(h.createdAt).toLocaleString('pt-PT')}</span></div></article>):<p className="empty">Ainda não foi gerado nenhum relatório em PDF.</p>}</div>}
  </section>;
}
function Notifications({token,flash}:{token:string;flash:(s:string,b?:boolean)=>void}) { const [items,setItems]=useState<any[]>([]); const load=()=>api('/notifications',token).then(setItems).catch(e=>flash(e.message,true)); useEffect(()=>{void load()},[]); return <section className="table"><div className="tablehead"><div><h2>Notificações</h2><p>{items.filter(x=>!x.read).length} por ler</p></div><button onClick={load}>Atualizar</button></div><div className="records">{items.length?items.map(item=><article key={item._id}><div><strong>{item.type}</strong><span>{item.message} · {new Date(item.createdAt).toLocaleString('pt-PT')}</span></div>{!item.read&&<button onClick={async()=>{await api(`/notifications/${item._id}/read`,token,{method:'PATCH'});load()}}>Marcar lida</button>}</article>):<p className="empty">Sem notificações.</p>}</div></section> }
function Accounts({token,flash}:{token:string;flash:(s:string,b?:boolean)=>void}) {
  const [rows,setRows]=useState<any[]>([]),[open,setOpen]=useState(false),[edit,setEdit]=useState<any>(null),[cargos,setCargos]=useState<any[]>([]);
  const load=()=>api('/users',token).then(setRows).catch(e=>flash(e.message,true));
  useEffect(()=>{void load();api('/cargos',token).then(setCargos)},[]);
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);const body:any=Object.fromEntries(data);if(!edit)body.cargoIds=data.getAll('cargoIds');try{await api(`/users${edit?`/${edit._id}`:""}`,token,{method:edit?'PUT':'POST',body:JSON.stringify(body)});flash(edit?'Conta atualizada.':'Conta e trabalhador criados.');setOpen(false);setEdit(null);load()}catch(x){flash((x as Error).message,true)}}
  async function del(x:any){if(!confirm(`Eliminar a conta de ${x.name}? Turnos futuros serão cancelados e notificados.`))return;try{await api(`/users/${x._id}`,token,{method:'DELETE'});flash('Conta eliminada — histórico preservado.');load()}catch(e){flash((e as Error).message,true)}}
  return <section className="table"><div className="tablehead"><div><h2>Contas de utilizador</h2><p>Cada funcionário cria automaticamente uma ficha de trabalhador.</p></div><button className="primary" onClick={()=>{setEdit(null);setOpen(true)}}>+ Conta</button></div>
    {open&&<form className="editor" onSubmit={save}><h3>{edit?'Editar':'Nova'} conta</h3><div className="formgrid"><label>Nome<input name="name" required defaultValue={edit?.name}/></label><label>Email<input name="email" type="email" required defaultValue={edit?.email}/></label>{!edit&&<label>Palavra-passe<input name="password" type="password" minLength={6} required/></label>}<label>Perfil<select name="role" defaultValue={edit?.role||'WORKER'}><option value="WORKER">Funcionário</option><option value="ADMIN">Administrador</option></select></label><label>Departamento<DepartmentSelect defaultValue={edit?.department}/></label>{!edit&&<label className="wide">Cargos<select name="cargoIds" multiple size={4}>{cargos.map(c=><option key={c._id} value={c._id}>{c.name}</option>)}</select><span className="hint">Ctrl/Cmd + clique para escolher mais do que um.</span></label>}</div><div className="actions"><button type="button" onClick={()=>{setOpen(false);setEdit(null)}}>Cancelar</button><button className="primary">Guardar</button></div></form>}
    <div className="records">{rows.map(x=><article key={x._id}><div><strong>{x.name} · {x.role}</strong><span>{x.email} · {x.active?'Ativa':'Inativa'}</span></div><div className="actions"><button onClick={()=>{setEdit(x);setOpen(true)}}>Editar</button><button onClick={async()=>{await api(`/users/${x._id}/status`,token,{method:'PATCH',body:JSON.stringify({active:!x.active})});load()}}>{x.active?'Desativar':'Ativar'}</button><button className="danger" onClick={()=>del(x)}>Eliminar</button></div></article>)}</div>
  </section>;
}
function Automation({token,flash}:{token:string;flash:(s:string,b?:boolean)=>void}){const [workers,setWorkers]=useState<any[]>([]),[tasks,setTasks]=useState<any[]>([]);useEffect(()=>{api('/workers',token).then(setWorkers);api('/tasks',token).then(setTasks)},[]);const submit=(path:string,message:string)=>async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const b:any=Object.fromEntries(new FormData(e.currentTarget));b.daysOfWeek=[1,2,3,4,5];if(path==='/shifts/generate')b.workerIds=workers.map(w=>w._id);try{const r=await api(path,token,{method:'POST',body:JSON.stringify(b)});flash(`${message}: ${r.created?.length||r.published||0} turno(s).`)}catch(x){flash((x as Error).message,true)}};const selects=<><label>Trabalhador<select name="workerId" required><option value="">Selecionar…</option>{workers.map(w=><option value={w._id}>{w.name}</option>)}</select></label><label>Tarefa<select name="taskId"><option value="">Sem tarefa</option>{tasks.map(t=><option value={t._id}>{t.title}</option>)}</select></label></>;return <section className="table"><div className="tablehead"><div><h2>Automação e recorrência</h2><p>Crie escalas recorrentes ou propostas automáticas configuráveis.</p></div></div><form className="editor" onSubmit={submit('/schedules','Escala recorrente criada')}><h3>Escala recorrente</h3><div className="formgrid">{selects}<label>De<input name="startDate" type="date" required/></label><label>Até<input name="endDate" type="date" required/></label><label>Início<input name="startTime" type="time" defaultValue="09:00" required/></label><label>Fim<input name="endTime" type="time" defaultValue="17:00" required/></label><label>Tipo<select name="type"><option>SHIFT</option><option>MEETING</option><option>MAINTENANCE</option><option>OTHER</option></select></label></div><button className="primary">Criar recorrência (2ª-6ª)</button></form><form className="editor" onSubmit={submit('/shifts/generate','Proposta gerada')}><h3>Gerar proposta</h3><div className="formgrid"><label>De<input name="start" type="date" required/></label><label>Até<input name="end" type="date" required/></label><label>Início<input name="startTime" type="time" defaultValue="09:00" required/></label><label>Fim<input name="endTime" type="time" defaultValue="17:00" required/></label><label>Tarefa<select name="taskId"><option value="">Sem tarefa</option>{tasks.map(t=><option value={t._id}>{t.title}</option>)}</select></label></div><button className="primary">Gerar proposta para a equipa</button></form></section>}
function Announcements({token,user,flash}:{token:string;user:User;flash:(s:string,b?:boolean)=>void}){
  const [rows,setRows]=useState<any[]>([]),[open,setOpen]=useState(false),[edit,setEdit]=useState<any>(null);
  const load=()=>api('/announcements',token).then(setRows).catch(e=>flash(e.message,true));
  useEffect(()=>{load()},[]);
  const save=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));try{await api(`/announcements${edit?`/${edit._id}`:""}`,token,{method:edit?"PUT":"POST",body:JSON.stringify(body)});flash(edit?"Aviso atualizado.":"Aviso criado como rascunho.");setOpen(false);setEdit(null);load()}catch(x){flash((x as Error).message,true)}};
  const publish=async(x:any)=>{try{await api(`/announcements/${x._id}/publish`,token,{method:"PATCH"});flash("Aviso publicado — trabalhadores notificados.");load()}catch(e){flash((e as Error).message,true)}};
  const unpublish=async(x:any)=>{try{await api(`/announcements/${x._id}/unpublish`,token,{method:"PATCH"});flash("Aviso voltou a rascunho.");load()}catch(e){flash((e as Error).message,true)}};
  const del=async(x:any)=>{if(!confirm("Eliminar este aviso?"))return;try{await api(`/announcements/${x._id}`,token,{method:"DELETE"});flash("Aviso eliminado.");load()}catch(e){flash((e as Error).message,true)}};
  if(user.role!=="ADMIN")
    return <section className="table"><div className="tablehead"><div><h2>Avisos</h2><p>{rows.length} publicado(s)</p></div></div><div className="records">{rows.length?rows.map(x=><article key={x._id}><div><strong>{x.title}</strong><span>{x.body}</span><br/><span>{new Date(x.publishedAt).toLocaleString('pt-PT')}</span></div></article>):<p className="empty">Sem avisos de momento.</p>}</div></section>;
  return <section className="table"><div className="tablehead"><div><h2>Avisos</h2><p>{rows.length} registo(s) · rascunhos e publicados</p></div><button className="primary" onClick={()=>{setEdit(null);setOpen(true)}}>+ Novo aviso</button></div>
    {open&&<form className="editor" onSubmit={save}><h3>{edit?"Editar":"Novo"} aviso</h3><div className="formgrid"><label>Título<input name="title" required defaultValue={edit?.title}/></label><label>Destinatários<select name="audience" defaultValue={edit?.audience||"ALL"}><option value="ALL">Todos os trabalhadores</option></select></label><label className="wide">Conteúdo<textarea name="body" required defaultValue={edit?.body}/></label></div><div className="actions"><button type="button" onClick={()=>setOpen(false)}>Cancelar</button><button className="primary">Guardar</button></div></form>}
    <div className="records">{rows.length?rows.map(x=><article key={x._id}><div><strong>{x.title}</strong><span>{x.status==="PUBLISHED"?`Publicado · ${new Date(x.publishedAt).toLocaleString('pt-PT')}`:"Rascunho"}</span></div><div className="actions"><button onClick={()=>{setEdit(x);setOpen(true)}}>Editar</button>{x.status==="PUBLISHED"?<button onClick={()=>unpublish(x)}>Despublicar</button>:<button onClick={()=>publish(x)}>Publicar</button>}<button className="danger" onClick={()=>del(x)}>Eliminar</button></div></article>):<p className="empty">Ainda não existem avisos.</p>}</div>
  </section>;
}
function Restrictions({token,flash}:{token:string;flash:(s:string,b?:boolean)=>void}){
  const [rows,setRows]=useState<any[]>([]),[workers,setWorkers]=useState<any[]>([]),[open,setOpen]=useState(false);
  const load=()=>api('/restrictions',token).then(setRows).catch(e=>flash(e.message,true));
  useEffect(()=>{load();api('/workers',token).then(setWorkers)},[]);
  const typeLabel=(t:string):string=>({MAX_WEEKLY_HOURS:'Máximo de horas semanais',MAX_MONTHLY_HOURS:'Máximo de horas mensais',MAX_YEARLY_HOURS:'Máximo de horas anuais',MIN_REST_HOURS:'Descanso mínimo entre turnos (horas)'} as Record<string,string>)[t]||t;
  const save=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));try{await api('/restrictions',token,{method:'POST',body:JSON.stringify(body)});flash('Restrição criada.');setOpen(false);load()}catch(x){flash((x as Error).message,true)}};
  const updateValue=async(x:any,value:string)=>{if(!value||Number(value)===x.value)return;try{await api(`/restrictions/${x._id}`,token,{method:'PUT',body:JSON.stringify({value})});flash('Restrição atualizada.');load()}catch(e){flash((e as Error).message,true)}};
  const del=async(x:any)=>{if(!confirm('Eliminar esta restrição? Volta a aplicar-se o valor por defeito.'))return;try{await api(`/restrictions/${x._id}`,token,{method:'DELETE'});flash('Restrição eliminada.');load()}catch(e){flash((e as Error).message,true)}};
  return <section className="table"><div className="tablehead"><div><h2>Restrições</h2><p>Regras configuráveis, globais ou por trabalhador. Sem registo aqui, aplicam-se os valores por defeito (11h de descanso; limites do perfil do trabalhador).</p></div><button className="primary" onClick={()=>setOpen(true)}>+ Restrição</button></div>
    {open&&<form className="editor" onSubmit={save}><h3>Nova restrição</h3><div className="formgrid"><label>Tipo<select name="type" required><option value="MIN_REST_HOURS">Descanso mínimo entre turnos (horas)</option><option value="MAX_WEEKLY_HOURS">Máximo de horas semanais</option><option value="MAX_MONTHLY_HOURS">Máximo de horas mensais</option><option value="MAX_YEARLY_HOURS">Máximo de horas anuais</option></select></label><label>Valor<input name="value" type="number" min={1} required/></label><label>Âmbito<select name="workerId" defaultValue=""><option value="">Global (todos os trabalhadores)</option>{workers.map(w=><option key={w._id} value={w._id}>{w.name}</option>)}</select></label></div><div className="actions"><button type="button" onClick={()=>setOpen(false)}>Cancelar</button><button className="primary">Guardar</button></div></form>}
    <div className="records">{rows.length?rows.map(x=><article key={x._id}><div><strong>{typeLabel(x.type)}</strong><span>{x.workerId?(workers.find(w=>w._id===x.workerId)?.name||'Trabalhador'):'Global'}</span></div><div className="actions"><input type="number" min={1} defaultValue={x.value} onBlur={e=>updateValue(x,e.target.value)} style={{width:70}}/><button className="danger" onClick={()=>del(x)}>Eliminar</button></div></article>):<p className="empty">Sem restrições configuradas — aplicam-se os valores por defeito.</p>}</div>
  </section>;
}
function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState<User | null>(
    JSON.parse(localStorage.getItem("user") || "null"),
  );
  const [page, setPage] = useState("dashboard");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const flash = (text: string, bad = false) => { setNotice({ text, bad }); window.setTimeout(() => setNotice(null), 4500); };
  useEffect(() => {
    if (!token || page !== "dashboard") return;
    setError("");
    api("/dashboard", token).then(setData).catch((e) => setError(e.message));
  }, [page, token]);
  if (!token || !user)
    return (
      <Login
        onLogin={(u, t) => {
          localStorage.setItem("token", t);
          localStorage.setItem("user", JSON.stringify(u));
          setToken(t);
          setUser(u);
        }}
      />
    );
  const logout = () => {
    localStorage.clear();
    setToken("");
    setUser(null);
  };
  const entries =
    user.role === "ADMIN"
      ? [
          ["dashboard", "Visão geral"],
          ["workers", "Trabalhadores"],
          ["users", "Contas"],
          ["tasks", "Tarefas"],
          ["cargos", "Cargos"],
          ["shifts", "Planeamento"],
          ["automation", "Automação"],
          ["availability", "Disponibilidades"],
          ["restrictions", "Restrições"],
          ["announcements", "Avisos"],
          ["reports", "Relatório de horas"],
          ["profile", "O meu perfil"],
          ["notifications", "Notificações"],
        ]
      : [["shifts", "Os meus turnos"], ["availability", "As minhas disponibilidades"], ["announcements", "Avisos"], ["reports", "Relatório de horas"], ["notifications", "Notificações"]];
  return (
    <div className="shell">
      <aside>
        <span className="brand">ShiftFlow</span>
        <nav>
          {entries.map(([id, label]) => (
            <button
              className={page === id ? "active" : ""}
              onClick={() => {
                setPage(id);
                setError("");
              }}
              key={id}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="logout" onClick={logout}>
          Terminar sessão
        </button>
      </aside>
      <main className="content">
        <header>
          <div>
            <p className="eyebrow">
              {user.role === "ADMIN" ? "Administrador" : "Trabalhador"}
            </p>
            <h1>{entries.find((x) => x[0] === page)?.[1]}</h1>
          </div>
          <div className="avatar">{user.name.slice(0, 1)}</div>
        </header>
        {notice && <p className={notice.bad ? "alert error" : "alert success"}>{notice.text}</p>}
        {error ? (
          <p className="error">{error}</p>
        ) : page === "dashboard" ? (
          <section className="cards">
            {Object.entries(data || {}).map(([k, v]) => (
              <article key={k}>
                <p>
                  {k === "workers" ? "Trabalhadores"
                    : k === "tasks" ? "Tarefas ativas"
                    : k === "assignments" ? "Afetações ativas"
                    : k === "utilization" ? "Taxa de utilização"
                    : "Turnos"}
                </p>
                <strong>{k === "utilization" ? `${v}%` : String(v)}</strong>
              </article>
            ))}
            {user.role === "ADMIN" && <article className="demo-card"><p>Cenário de defesa</p><button className="primary" onClick={async () => { try { const result = await api("/demo/seed", token, { method: "POST" }); flash(result.message); api("/dashboard", token).then(setData); } catch (e) { flash((e as Error).message, true); } }}>Carregar dados demo</button></article>}
          </section>
        ) : page === "shifts" ? <Shifts token={token} user={user} flash={flash} />
        : page === "reports" ? <ReportsV2 token={token} user={user} flash={flash} />
        : page === "notifications" ? <Notifications token={token} flash={flash} />
        : page === "users" ? <Accounts token={token} flash={flash} />
        : page === "automation" ? <Automation token={token} flash={flash} />
        : page === "announcements" ? <Announcements token={token} user={user} flash={flash} />
        : page === "restrictions" ? <Restrictions token={token} flash={flash} />
        : page === "profile" ? <Profile token={token} user={user} setUser={setUser} flash={flash} />
        : (
          <Crud kind={page as "workers"|"tasks"|"availability"|"cargos"} token={token} flash={flash} />
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
