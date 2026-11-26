// Local static preview only; production hosting is independent.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const types={'/':'text/html','/index.html':'text/html','/styles.css':'text/css','/app.js':'text/javascript','/adapter.js':'text/javascript','/live.js':'text/javascript','/logo.svg':'image/svg+xml','/adapter.test.js':'text/javascript','/live.test.js':'text/javascript'};
createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(!Object.hasOwn(types,path)){res.writeHead(404);return res.end('Not found');}try{res.setHeader('Content-Type',types[path]);res.end(await readFile(new URL('.'+(path==='/'?'/index.html':path),import.meta.url)));}catch{res.writeHead(500);res.end('Unable to read file');}}).listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('http://127.0.0.1:4173'));
