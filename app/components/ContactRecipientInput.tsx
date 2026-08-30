import { XIcon } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";

export interface RecipientContact { id:string; name:string; email:string; company?:string; position?:string; }
function normalizeContacts(value:unknown):RecipientContact[]{if(!Array.isArray(value))return[];return value.map((c:any)=>({id:c?.id||c?.email||"",name:(c?.name||c?.email||"").trim(),email:(c?.email||"").trim().toLowerCase(),company:c?.company||"",position:c?.position||""})).filter(c=>c.email);}
export function contactsFromSettings(value:unknown):RecipientContact[]{return normalizeContacts(value);}
function splitRecipients(value:string){return value.split(/[;,]/).map(v=>v.trim()).filter(Boolean);}
function emailFromValue(value:string){const match=value.match(/<([^<>\s]+@[^<>\s]+)>/);return(match?.[1]||value).trim().toLowerCase();}
function validEmail(value:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFromValue(value));}

export default function ContactRecipientInput({label,value,onChange,contacts,placeholder,required=false}:{label?:string;value:string;onChange:(value:string)=>void;contacts:RecipientContact[];placeholder:string;required?:boolean}){
 const[input,setInput]=useState("");const[open,setOpen]=useState(false);const inputRef=useRef<HTMLInputElement>(null);const recipients=useMemo(()=>splitRecipients(value).map(emailFromValue).filter(Boolean),[value]);const query=input.trim().toLowerCase();const suggestions=useMemo(()=>contacts.filter(c=>!recipients.includes(c.email)&&(!query||c.name.toLowerCase().includes(query)||c.email.toLowerCase().includes(query)||c.company?.toLowerCase().includes(query)||c.position?.toLowerCase().includes(query))).slice(0,8),[contacts,recipients,query]);
 const add=(raw:string)=>{const email=emailFromValue(raw);if(!validEmail(email))return false;if(!recipients.includes(email))onChange([...recipients,email].join(", "));setInput("");setOpen(false);return true;};
 const commitInput=()=>{const raw=input.trim();if(!raw)return;const parts=splitRecipients(raw);if(parts.length>1){let next=[...recipients];for(const part of parts){const email=emailFromValue(part);if(validEmail(email)&&!next.includes(email))next.push(email);}onChange(next.join(", "));setInput("");setOpen(false);return;}add(raw);};
 const select=(contact:RecipientContact)=>{add(contact.email);inputRef.current?.focus();};
 const remove=(index:number)=>onChange(recipients.filter((_,i)=>i!==index).join(", "));
 return <div className="relative w-full">
  {label&&<div className="text-xs font-medium text-kumo-subtle mb-1">{label}</div>}
  <div className="min-h-9 flex flex-wrap items-center gap-1.5 rounded-md border border-kumo-line bg-kumo-base px-2 py-1 focus-within:ring-1 focus-within:ring-kumo-focus" onClick={()=>inputRef.current?.focus()}>
   {recipients.map((email,index)=>{const contact=contacts.find(c=>c.email===email);return <span key={`${email}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-kumo-tint px-2 py-1 text-xs text-kumo-default max-w-full"><span className="truncate max-w-52">{contact?.name||email}</span><button type="button" aria-label={`Remove ${contact?.name||email}`} onClick={(e)=>{e.stopPropagation();remove(index);}} className="shrink-0 rounded-full hover:bg-kumo-line p-0.5"><XIcon size={12}/></button></span>;})}
   <input ref={inputRef} type="text" value={input} placeholder={recipients.length?"Add recipient…":placeholder} onChange={e=>{setInput(e.target.value);setOpen(true);}} onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),150)} onKeyDown={e=>{if(e.key==="Enter"||e.key===","||e.key===";"){e.preventDefault();e.stopPropagation();commitInput();}else if(e.key==="Backspace"&&!input&&recipients.length){e.preventDefault();e.stopPropagation();remove(recipients.length-1);}else if(e.key==="Tab"&&input.trim()){e.preventDefault();commitInput();}}} className="flex-1 min-w-32 bg-transparent outline-none border-0 px-1 py-1 text-sm text-kumo-default placeholder:text-kumo-subtle" required={required&&recipients.length===0}/>
  </div>
  {open&&suggestions.length>0&&<div className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-kumo-line bg-kumo-base shadow-lg">{suggestions.map(contact=><button key={contact.id||contact.email} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>select(contact)} className="w-full text-left px-3 py-2 hover:bg-kumo-tint"><div className="text-sm font-medium truncate">{contact.name}</div><div className="text-xs text-kumo-subtle truncate">{contact.email}{contact.company?` · ${contact.company}`:""}</div></button>)}</div>}
 </div>;
}
