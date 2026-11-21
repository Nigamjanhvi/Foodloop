import { useEffect, useRef, useState } from 'react';

export interface FoodLoopEvent { type:string; resource_type?:string|null; resource_id?:string|null; payload?:Record<string,unknown>; created_at?:string }
const eventName='foodloop:server-event';
const streamStatusName='foodloop:stream-status';

export function useFoodLoopRealtime(userId:string){
  useEffect(()=>{
    if(!userId)return;
    let stopped=false;let controller:AbortController|undefined;let cursor='';let attempts=0;
    const tokenChanged=()=>controller?.abort();window.addEventListener('foodloop:token-changed',tokenChanged);
    const status=(value:'connected'|'reconnecting'|'offline')=>window.dispatchEvent(new CustomEvent(streamStatusName,{detail:value}));
    const wait=(ms:number)=>new Promise<void>((resolve)=>{const timer=window.setTimeout(resolve,ms);controller?.signal.addEventListener('abort',()=>{window.clearTimeout(timer);resolve();},{once:true});});
    async function connect(){
      while(!stopped){
        const token=sessionStorage.getItem('foodloop.accessToken');if(!token){status('offline');return;}
        controller=new AbortController();
        try{
          const response=await fetch(`${import.meta.env.VITE_API_URL??'/api/v1'}/events/stream`,{headers:{Authorization:`Bearer ${token}`,...(cursor?{'Last-Event-ID':cursor}:{})},signal:controller.signal});
          if(response.status===401||response.status===403){status('offline');attempts++;await wait(Math.min(30_000,1000*2**Math.min(attempts-1,5)));continue;}
          if(!response.ok||!response.body)throw new Error(`SSE connection returned ${response.status}`);
          attempts=0;status('connected');const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
          while(!stopped){
            const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
            let boundary=buffer.indexOf('\n\n');
            while(boundary>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);boundary=buffer.indexOf('\n\n');
              let id='';let event='message';const data:string[]=[];
              for(const line of block.split('\n')){if(line.startsWith('id:'))id=line.slice(3).trim();else if(line.startsWith('event:'))event=line.slice(6).trim();else if(line.startsWith('data:'))data.push(line.slice(5).trimStart());}
              const duplicate=Boolean(id&&id===cursor);if(id)cursor=id;
              if(event==='auth-expired'){status('offline');stopped=true;controller.abort();break;}
              if(event==='update'&&data.length&&!duplicate){try{const detail=JSON.parse(data.join('\n')) as FoodLoopEvent;window.dispatchEvent(new CustomEvent(eventName,{detail}));}catch{/* Ignore malformed frames and keep the connection alive. */}}
            }
          }
        }catch{if(stopped)break;if(controller.signal.aborted){attempts=0;continue;}}
        if(!stopped){status('reconnecting');attempts++;await wait(Math.min(30_000,1000*2**Math.min(attempts-1,5)));}
      }
    }
    void connect();
    return()=>{stopped=true;window.removeEventListener('foodloop:token-changed',tokenChanged);controller?.abort();window.dispatchEvent(new CustomEvent(streamStatusName,{detail:'offline'}));};
  },[userId]);
}

export function useFoodLoopEvent(types:string[],callback:(event:FoodLoopEvent)=>void){
  const callbackRef=useRef(callback);callbackRef.current=callback;const key=types.join('|');
  useEffect(()=>{let timer:number|undefined;const accepted=new Set(types);const listener=(raw:Event)=>{
    const event=(raw as CustomEvent<FoodLoopEvent>).detail;if(!accepted.has('*')&&!accepted.has(event.type))return;
    if(timer!==undefined)window.clearTimeout(timer);timer=window.setTimeout(()=>callbackRef.current(event),120);
  };window.addEventListener(eventName,listener);return()=>{window.removeEventListener(eventName,listener);if(timer!==undefined)window.clearTimeout(timer);};},[key]);
}

export function useFoodLoopStreamStatus(){
  const [status,setStatus]=useState<'connected'|'reconnecting'|'offline'>('offline');
  useEffect(()=>{const listener=(event:Event)=>setStatus((event as CustomEvent<'connected'|'reconnecting'|'offline'>).detail);window.addEventListener(streamStatusName,listener);return()=>window.removeEventListener(streamStatusName,listener);},[]);
  return status;
}
