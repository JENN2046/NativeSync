// A pairing link only prefills the existing explicit pairing form.
// The short-lived code never enters request URLs, referrers or durable browser storage.
export function consumePairingLink({location,history,secureContext}){
 const hash=location.hash||'';
 if(!hash.startsWith('#pair='))return null;
 try{history.replaceState(history.state,'',location.pathname+location.search);}catch{return null;}
 if(!secureContext||location.protocol!=='https:')return null;
 return /^#pair=([A-Za-z0-9_-]{32})$/.exec(hash)?.[1]||null;
}
