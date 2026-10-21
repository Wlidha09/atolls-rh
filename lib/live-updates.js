// Only a revision marker is streamed. HR data always comes from the authenticated API.
export function subscribeToUpdates(onChange,onStatus=()=>{}){
 let stopped=false,source,refreshTimer,reconnectTimer,controller,connecting=false;
 function close(){source?.close();source=null;clearTimeout(refreshTimer);clearTimeout(reconnectTimer);controller?.abort()}
 async function connect(){
  if(stopped||connecting||document.visibilityState==='hidden')return;
  close();connecting=true;controller=new AbortController();onStatus('Connecting…');
  try{
   const response=await fetch('/api/realtime',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store',signal:controller.signal});
   if(response.status===401){onChange();throw Error('Session expired')}
   if(!response.ok)throw Error('Realtime unavailable');
   const {customToken,apiKey,databaseURL}=await response.json();
   const auth=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:customToken,returnSecureToken:true}),signal:controller.signal});
   if(!auth.ok)throw Error('Realtime authentication unavailable');const token=await auth.json();if(stopped)return;
   const url=new URL('/atolls/revision.json',databaseURL);url.searchParams.set('auth',token.idToken);source=new EventSource(url.href);
   source.onopen=()=>onStatus('Live updates');
   for(const type of ['put','patch'])source.addEventListener(type,()=>{onStatus('Live updates');onChange()});
   const reconnect=()=>{close();onStatus('Updates every 30s');if(!stopped)reconnectTimer=setTimeout(connect,10000)};
   source.addEventListener('auth_revoked',reconnect);source.addEventListener('cancel',reconnect);source.onerror=()=>onStatus('Updates every 30s');
   refreshTimer=setTimeout(connect,Math.min(Number(token.expiresIn||3600)*1000-60000,45*60000));
  }catch(error){if(!stopped){onStatus('Updates every 30s');reconnectTimer=setTimeout(connect,30000)}}finally{connecting=false}
 }
 const poll=setInterval(()=>{if(!stopped&&document.visibilityState!=='hidden')onChange()},30000);
 const visible=()=>{if(document.visibilityState==='hidden')close();else{onChange();connect()}};
 const focus=()=>{if(document.visibilityState!=='hidden')onChange()};
 document.addEventListener('visibilitychange',visible);window.addEventListener('focus',focus);connect();
 return ()=>{stopped=true;close();clearInterval(poll);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',focus)};
}
