const crypto = require('crypto');
const dns = require('dns').promises;
const https = require('https');
const net = require('net');
const db = require('./db');

function isPublicAddress(address){
  const family=net.isIP(address);
  if(family===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===192&&p[1]===0)||(p[0]===192&&p[1]===88&&p[2]===99)||(p[0]===198&&(p[1]===18||p[1]===19||p[1]===51&&p[2]===100))||(p[0]===203&&p[1]===0&&p[2]===113));}
  if(family===6){const v=address.toLowerCase();return !(v==='::1'||v==='::'||v.startsWith('fc')||v.startsWith('fd')||v.startsWith('fe8')||v.startsWith('fe9')||v.startsWith('fea')||v.startsWith('feb')||v.startsWith('::ffff:')||!/^2[0-9a-f]{3}:/.test(v));}
  return false;
}
async function resolvePublicHost(hostname){
  if(net.isIP(hostname)) {if(!isPublicAddress(hostname))throw new Error('L’adresse de webhook doit être publique.');return [{address:hostname,family:net.isIP(hostname)}];}
  const addresses=await dns.lookup(hostname,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address)))throw new Error('Le domaine du webhook doit résoudre uniquement vers des adresses publiques.');
  return addresses;
}
function key(){const secret=process.env.WEBHOOK_ENCRYPTION_KEY||process.env.JWT_SECRET||'';if(secret.length<32)throw new Error('Clé de chiffrement des webhooks invalide.');return crypto.createHash('sha256').update(`webhook:${secret}`).digest();}
function encryptSecret(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return {ciphertext:ciphertext.toString('base64'),iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex')};}
function decryptSecret(item){const decipher=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(item.secret_iv,'hex'));decipher.setAuthTag(Buffer.from(item.secret_tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(item.secret_ciphertext,'base64')),decipher.final()]).toString('utf8');}
async function sendPinned(url,addresses,body,signature,eventId,timestamp){
  const destination=new URL(url),address=addresses[0];
  return new Promise((resolve,reject)=>{
    const request=https.request(destination,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'X-Rapports-Signature':`sha256=${signature}`,'X-Rapports-Event-Id':eventId,'X-Rapports-Timestamp':timestamp},lookup:(_hostname,_options,callback)=>callback(null,address.address,address.family),timeout:5000},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
    request.on('timeout',()=>request.destroy(new Error('Délai dépassé')));request.on('error',reject);request.end(body);
  });
}
exports.validateEndpoint=async value=>{
  let url;try{url=new URL(value);}catch(_){throw new Error('URL de webhook invalide.');}
  const hostname=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||hostname==='localhost'||hostname.endsWith('.local')||hostname.endsWith('.internal'))throw new Error('Un webhook doit utiliser HTTPS public sur le port 443.');
  return {url:url.toString(),addresses:await resolvePublicHost(hostname)};
};
exports.encryptSecret=encryptSecret;
exports.dispatchEvent=async(ownerId,event,payload)=>{
  try {
    const [targets]=await db.query('SELECT * FROM webhook_endpoints WHERE owner_id=? AND is_active=1 AND revoked_at IS NULL',[ownerId]);
    await Promise.allSettled(targets.map(async target=>{
      try {const checked=await exports.validateEndpoint(target.endpoint_url),secret=decryptSecret(target),timestamp=String(Math.floor(Date.now()/1000)),eventId=crypto.randomUUID();const body=JSON.stringify({id:eventId,event,occurredAt:new Date().toISOString(),data:payload});const signature=crypto.createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');const status=await sendPinned(checked.url,checked.addresses,body,signature,eventId,timestamp);if(status<200||status>=300)console.warn('Webhook HTTP non-2xx',target.id,status);}
      catch(error){console.warn('Échec webhook',target.id,error.message);}
    }));
  }catch(error){if(error.code!=='ER_NO_SUCH_TABLE')console.error('Diffusion webhook indisponible:',error.message);}
};
