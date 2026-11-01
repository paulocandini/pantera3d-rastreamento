import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export function normalizeCode(value) { return String(value ?? '').trim().toUpperCase().replace(/[\s.-]/g,''); }
export function validCode(code) { return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code) || /^\d{10,20}$/.test(code); }
export function findShipment(payload, code) {
  const rows=Array.isArray(payload)?payload:Array.isArray(payload?.data)?payload.data:Array.isArray(payload?.orders)?payload.orders:[];
  return rows.find(o=>[o.tracking,o.self_tracking].some(v=>v && normalizeCode(v)===code));
}
export function publicShipment(o) {
  const allowed=new Set(['pending','released','posted','delivered','undelivered','suspended','canceled']);
  const dates=['created_at','paid_at','generated_at','posted_at','delivered_at','canceled_at'].map(key=>({key,date:o[key]})).filter(x=>x.date && Number.isFinite(Date.parse(x.date)));
  return {code:normalizeCode(o.tracking||o.self_tracking),status:allowed.has(o.status)?o.status:'unknown',carrier:String(o.service?.company?.name||o.company?.name||'Transportadora').slice(0,80),service:String(o.service?.name||'').slice(0,80),events:dates,updatedAt:new Date().toISOString()};
}

const buckets=new Map(), cache=new Map();
export function createServer({token=process.env.ME_TOKEN,fetcher=fetch}={}) {
 return http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors https://pantera3d.com.br https://www.pantera3d.com.br https://s2qr8b-g0.myshopify.com");
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(url.pathname==='/healthz')return json(token?200:503,{ok:!!token});
  if(req.method!=='GET')return json(405,{message:'Método não permitido.'});
  if(url.pathname==='/api/tracking'){
   const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
   const now=Date.now();let bucket=buckets.get(ip);if(!bucket||bucket.until<now){bucket={count:0,until:now+60000};buckets.set(ip,bucket);}if(++bucket.count>15)return json(429,{message:'Aguarde um minuto antes de consultar novamente.'});
   if(buckets.size>5000)for(const[k,v]of buckets)if(v.until<now)buckets.delete(k);
   const code=normalizeCode(url.searchParams.get('code'));if(!validCode(code))return json(400,{message:'Confira o código de rastreamento recebido por e-mail.'});
   if(!token)return json(503,{message:'A consulta está temporariamente indisponível. Fale com nossa equipe.'});
   if(cache.get(code)?.until>now)return json(200,cache.get(code).data);
   try{
    const response=await fetcher('https://melhorenvio.com.br/api/v2/me/orders/search?q='+encodeURIComponent(code),{headers:{Authorization:'Bearer '+token,Accept:'application/json','User-Agent':'PANTERA 3D Rastreamento (contato@pantera3d.com.br)'},signal:AbortSignal.timeout(20000)});
    if(!response.ok)return json(503,{message:'A transportadora não respondeu à consulta. Tente novamente em instantes.'});
    const shipment=findShipment(await response.json(),code);
    if(!shipment)return json(404,{message:'Envio não localizado. Confira o código. Uma postagem recente pode levar algum tempo para aparecer.'});
    const data=publicShipment(shipment);cache.set(code,{until:now+120000,data});if(cache.size>2000)cache.delete(cache.keys().next().value);return json(200,data);
   }catch{return json(503,{message:'Não foi possível consultar agora. Tente novamente em instantes.'});}
  }
  if(url.pathname==='/'||url.pathname==='/embed'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(new URL('./index.html',import.meta.url)));return;
  }
  json(404,{message:'Página não encontrada.'});
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const server=createServer();server.listen(Number(process.env.PORT||3000),'0.0.0.0');process.on('SIGTERM',()=>server.close());}
