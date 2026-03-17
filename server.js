const http = require('http');
const fs = require('fs');
const path = require('path');

let STORE = {
  users:[], settings:{}, designations:[], tickets:[], editlog:[],
  notifications:[], chat:{rooms:{}}, blocks:{}, tracker:{}, taskAtt:{}, 
  removedUsers:[], // Track removed user IDs permanently
  _ts:0
};

const DB_FILE = path.join('/tmp', 'habitly_db.json');
const HTML_FILE = path.join(__dirname, 'index.html');

try {
  if(fs.existsSync(DB_FILE)){
    STORE = JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
    if(!STORE.removedUsers) STORE.removedUsers=[];
    console.log('Loaded. Users:', (STORE.users||[]).length, 'Removed:', (STORE.removedUsers||[]).length);
  }
} catch(e){ console.log('Fresh start'); }

function saveStore(){ 
  try{fs.writeFileSync(DB_FILE, JSON.stringify(STORE));}catch(e){}
}

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

function readBody(req,cb){
  let body='';
  req.on('data',c=>body+=c);
  req.on('end',()=>{try{cb(JSON.parse(body));}catch(e){cb({});}});
}

const server = http.createServer((req,res)=>{
  cors(res);
  if(req.method==='OPTIONS'){res.writeHead(200);res.end();return;}
  const url = req.url.split('?')[0];

  // Serve app
  if(req.method==='GET' && (url==='/'||url==='/app')){
    try{
      const html=fs.readFileSync(HTML_FILE,'utf8');
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.writeHead(200); res.end(html);
    }catch(e){
      res.setHeader('Content-Type','text/html');
      res.writeHead(200); res.end('<h1>Habitly loading...</h1>');
    }
    return;
  }

  res.setHeader('Content-Type','application/json');

  if(req.method==='GET' && url==='/health'){
    res.writeHead(200);
    res.end(JSON.stringify({ok:true,app:'Habitly v2',users:(STORE.users||[]).length}));
    return;
  }

  if(req.method==='GET' && url==='/data'){
    res.writeHead(200);
    res.end(JSON.stringify({ok:true,data:STORE}));
    return;
  }

  // POST remove user - hard delete
  if(req.method==='POST' && url==='/remove/user'){
    readBody(req,function(body){
      const id=body.userId;
      if(!id){res.writeHead(400);res.end(JSON.stringify({ok:false}));return;}
      // Add to removed list so it never comes back
      if(!STORE.removedUsers) STORE.removedUsers=[];
      if(!STORE.removedUsers.includes(id)) STORE.removedUsers.push(id);
      // Remove from users array
      STORE.users=(STORE.users||[]).filter(function(u){return u.id!==id;});
      // Clean their data
      if(STORE.blocks&&STORE.blocks[id]) delete STORE.blocks[id];
      if(STORE.tracker&&STORE.tracker[id]) delete STORE.tracker[id];
      STORE._ts=Date.now();
      saveStore();
      res.writeHead(200);
      res.end(JSON.stringify({ok:true,removed:id}));
    });
    return;
  }

  if(req.method==='POST' && url==='/sync/user'){
    readBody(req,function(body){
      const uid=body.userId;
      if(!uid){res.writeHead(400);res.end(JSON.stringify({ok:false}));return;}
      // Don't restore removed users
      if((STORE.removedUsers||[]).includes(uid)){
        res.writeHead(200);
        res.end(JSON.stringify({ok:false,reason:'user removed'}));
        return;
      }
      if(!STORE.blocks)STORE.blocks={};
      if(!STORE.tracker)STORE.tracker={};
      if(!STORE.taskAtt)STORE.taskAtt={};
      if(body.blocks!==undefined)STORE.blocks[uid]=body.blocks;
      if(body.tracker!==undefined)STORE.tracker[uid]=body.tracker;
      if(body.taskAtt)Object.assign(STORE.taskAtt,body.taskAtt);
      STORE._ts=Date.now();
      saveStore();
      res.writeHead(200);
      res.end(JSON.stringify({ok:true}));
    });
    return;
  }

  if(req.method==='POST' && url==='/sync/shared'){
    readBody(req,function(body){
      if(body.users&&Array.isArray(body.users)){
        if(!STORE.users)STORE.users=[];
        if(!STORE.removedUsers)STORE.removedUsers=[];
        body.users.forEach(function(u){
          // Never re-add removed users
          if(STORE.removedUsers.includes(u.id)) return;
          const idx=STORE.users.findIndex(su=>su.id===u.id);
          if(idx===-1)STORE.users.push(u);
          else STORE.users[idx]=u;
        });
      }
      ['settings','designations','tickets','editlog','notifications','chat'].forEach(function(k){
        if(body[k]!==undefined)STORE[k]=body[k];
      });
      STORE._ts=Date.now();
      saveStore();
      res.writeHead(200);
      res.end(JSON.stringify({ok:true}));
    });
    return;
  }

  if(req.method==='POST' && url==='/data'){
    readBody(req,function(body){
      if(!STORE.removedUsers)STORE.removedUsers=[];
      if(body.users&&Array.isArray(body.users)){
        if(!STORE.users)STORE.users=[];
        body.users.forEach(function(u){
          if(STORE.removedUsers.includes(u.id)) return;
          const idx=STORE.users.findIndex(su=>su.id===u.id);
          if(idx===-1)STORE.users.push(u);
          else STORE.users[idx]=u;
        });
      }
      if(body.blocks){if(!STORE.blocks)STORE.blocks={};Object.keys(body.blocks).forEach(k=>{STORE.blocks[k]=body.blocks[k];});}
      if(body.tracker){if(!STORE.tracker)STORE.tracker={};Object.keys(body.tracker).forEach(k=>{if(!STORE.tracker[k])STORE.tracker[k]={};Object.assign(STORE.tracker[k],body.tracker[k]);});}
      ['settings','designations','tickets','editlog','notifications','chat','taskAtt'].forEach(k=>{if(body[k]!==undefined)STORE[k]=body[k];});
      STORE._ts=Date.now();
      saveStore();
      res.writeHead(200);
      res.end(JSON.stringify({ok:true,ts:STORE._ts}));
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ok:false}));
});

const PORT = process.env.PORT||3000;
server.listen(PORT,()=>console.log('Habitly v2 on port',PORT));
