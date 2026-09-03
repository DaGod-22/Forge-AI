'use client';

import { useEffect, useMemo, useState } from 'react';

type Kind='website'|'app'|'game';
type FileItem={path:string;content:string};
type Result={files:FileItem[];previewHtml:string;summary:string;mode:string;notice?:string};

const starter='Build a polished productivity app with a dashboard, tasks, search, responsive layout, keyboard-friendly controls and a dark premium design.';

export default function Home(){
 const [kind,setKind]=useState<Kind>('website');
 const [prompt,setPrompt]=useState('');
 const [files,setFiles]=useState<FileItem[]>([]);
 const [selected,setSelected]=useState('');
 const [preview,setPreview]=useState('');
 const [summary,setSummary]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 useEffect(()=>{try{const s=localStorage.getItem('forge-project');if(s){const p=JSON.parse(s);setFiles(p.files||[]);setSelected(p.selected||'');setPreview(p.preview||'')}}catch{}},[]);
 useEffect(()=>{if(files.length||preview)localStorage.setItem('forge-project',JSON.stringify({files,selected,preview}))},[files,selected,preview]);
 const current=useMemo(()=>files.find(f=>f.path===selected)||files[0], [files,selected]);
 async function generate(){setBusy(true);setError('');setNotice('');try{const r=await fetch('/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:prompt||starter,type:kind,existingFiles:files})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Generation failed');setFiles(d.files);setSelected(d.files[0]?.path||'');setPreview(d.previewHtml||'');setSummary(d.summary||'');if(d.notice)setNotice(d.notice)}catch(e){setError(e instanceof Error?e.message:'Generation failed')}finally{setBusy(false)}}
 function updateCurrent(v:string){if(!current)return;setFiles(prev=>prev.map(f=>f.path===current.path?{...f,content:v}:f))}
 function download(){const payload=files.map(f=>`===== ${f.path} =====\n${f.content}`).join('\n\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([payload],{type:'text/plain'}));a.download='forge-project.txt';a.click();URL.revokeObjectURL(a.href)}
 function saveFolder(){const picker=(window as any).showDirectoryPicker;if(!picker){download();return}picker().then(async(dir:any)=>{for(const f of files){const parts=f.path.split('/');let cur=dir;for(const part of parts.slice(0,-1))cur=await cur.getDirectoryHandle(part,{create:true});const h=await cur.getFileHandle(parts.at(-1),{create:true});const w=await h.createWritable();await w.write(f.content);await w.close()}}).catch(()=>{})}
 return <div className="app"><header className="top"><div className="brand"><div className="logo">⚒</div>Forge AI</div><div className="row"><button className="secondary" onClick={saveFolder}>Save project</button><button className="secondary" onClick={download}>Export</button></div></header><div className="workspace"><aside className="side"><div className="muted" style={{fontSize:12,marginBottom:10}}>PROJECT FILES</div>{files.length?<div className="tree">{files.map(f=><button key={f.path} className={'file '+(current?.path===f.path?'selected':'')} onClick={()=>setSelected(f.path)}>▸ {f.path}</button>)}</div>:<p className="muted" style={{fontSize:13}}>Your generated files will appear here.</p>}</aside><main className="main"><section className="card hero"><div className="muted" style={{fontSize:13,fontWeight:700,letterSpacing:1}}>AI PRODUCT BUILDER</div><h1>Describe it. Forge it.</h1><p className="muted">Build real websites, web apps and playable browser games. Generate, inspect, edit and save the project.</p><div className="types">{(['website','app','game'] as Kind[]).map(k=><button key={k} className={'chip '+(kind===k?'active':'')} onClick={()=>setKind(k)}>{k==='website'?'Website':k==='app'?'Web app':'Game'}</button>)}</div><textarea className="prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={starter}/><div className="row" style={{marginTop:12}}><button className="primary" onClick={generate} disabled={busy}>{busy?'Forging…':'Forge it'}</button><button className="secondary" onClick={()=>{setPrompt('Make the current project significantly better: improve UX, add missing functionality, fix bugs, make it responsive and production-ready.')}}>Improve current</button></div>{summary&&<p className="status">{summary}</p>}{notice&&<div className="status">{notice}</div>}{error&&<div className="error">{error}</div>}</section>{current&&<section className="card" style={{marginTop:16,padding:16}}><div className="row" style={{justifyContent:'space-between'}}><b>{current.path}</b><span className="muted" style={{fontSize:12}}>Editable source</span></div><textarea className="code" style={{width:'100%',minHeight:430,resize:'vertical'}} value={current.content} onChange={e=>updateCurrent(e.target.value)}/></section>}</main><aside className="preview"><div className="row" style={{justifyContent:'space-between',marginBottom:10}}><b>Live preview</b><span className="muted" style={{fontSize:12}}>{files.length?`${files.length} file${files.length===1?'':'s'}`:'Waiting'}</span></div>{preview?<iframe className="frame" title="Forge preview" sandbox="allow-scripts" srcDoc={preview}/>:<div className="frame" style={{display:'grid',placeItems:'center',color:'#667085',background:'#0d1018'}}>Generate something to preview it.</div>}</aside></div></div>
}