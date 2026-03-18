const http = require('http');
const fs = require('fs');
const path = require('path');

let STORE = {
  users:[], settings:{}, designations:[], tickets:[], editlog:[],
  notifications:[], chat:{rooms:{}}, blocks:{}, tracker:{}, taskAtt:{},
  deletedUsers:[], _ts:0
};

const DB_FILE = path.join('/tmp', 'habitly_db.json');
const HTML_FILE = path.join(__dirname, 'index.html');

try {
  if(fs.existsSync(DB_FILE)){
    STORE = JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
    if(!STORE.deletedUsers) STORE.deletedUsers=[];
    // Clean duplicates on startup
    var seen={}, clean=[];
    (STORE.users||[]).forEach(function(u){
      if(!u.email) return;
      var key=u.email.toLowerCase();
      if(STORE.deletedUsers.includes(u.id)||u._deleted) return;
      if(!seen[key]){ seen[key]=u; clean.push(u); }
      else if(u.status==='active' && seen[key].status!=='active'){
        var i=clean.indexOf(seen[key]); clean[i]=u; seen[key]=u;
      }
    });
    if(clean.length < (STORE.users||[]).length){
      console.log('Cleaned '+(STORE.users.length-clean.length)+' duplicate users on startup');
      STORE.users=clean;
    }
    console.log('Loaded. Users:', STORE.users.length);
  }
} catch(e){ console.log('Fresh start'); }

function saveStore(){
  try{fs.writeFileSync(DB_FILE, JSON.stringify(STORE));}catch(e){}
}

// Merge users by email (prevents duplicates)
function mergeUsers(incoming){
  if(!Array.isArray(incoming)) return;
  if(!STORE.users) STORE.users=[];
  incoming.forEach(function(u){
    if(!u.email) return;
    if((STORE.deletedUsers||[]).includes(u.id)||u._deleted) return;
    var key=u.email.toLowerCase();
    // Find by ID or email
    var ex=STORE.users.find(function(x){return x.id===u.id;}) ||
           STORE.users.find(function(x){return x.email&&x.email.toLowerCase()===key;});
    if(!ex){ STORE.users.push(u); }
    else { Object.assign(ex, u); ex.id=ex.id; } // keep existing ID
  });
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

  if(req.method==='GET' && (url==='/' || url==='/app')){
    try{
      const html = fs.readFileSync(HTML_FILE,'utf8');
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.writeHead(200); res.end(html);
    }catch(e){
      res.writeHead(200); res.end('<h1>Loading...</h1><script>setTimeout(()=>location.reload(),3000)</script>');
    }
    return;
  }

  res.setHeader('Content-Type','application/json');

  if(req.method==='GET' && url==='/health'){
    res.writeHead(200);
    res.end(JSON.stringify({ok:true,app:'Habitly v3',users:STORE.users.length,deleted:(STORE.deletedUsers||[]).length}));
    return;
  }

  if(req.method==='GET' && url==='/data'){
    res.writeHead(200);
    res.end(JSON.stringify({ok:true,data:STORE}));
    return;
  }

  if(req.method==='POST' && url==='/sync/user'){
    readBody(req,function(body){
      const uid=body.userId;
      if(!uid){res.writeHead(400);res.end(JSON.stringify({ok:false}));return;}
      if((STORE.deletedUsers||[]).includes(uid)){
        res.writeHead(200);res.end(JSON.stringify({ok:true,skipped:'deleted'}));return;
      }
      if(!STORE.blocks)STORE.blocks={};
      if(!STORE.tracker)STORE.tracker={};
      if(!STORE.taskAtt)STORE.taskAtt={};
      if(body.blocks!==undefined)STORE.blocks[uid]=body.blocks;
      if(body.tracker!==undefined)STORE.tracker[uid]=body.tracker;
      if(body.taskAtt)Object.assign(STORE.taskAtt,body.taskAtt);
      STORE._ts=Date.now();
      saveStore();
      res.writeHead(200);res.end(JSON.stringify({ok:true}));
    });
    return;
  }

  if(req.method==='POST' && url==='/sync/shared'){
    readBody(req,function(body){
      // Process deletions first
      if(body.deletedUsers&&Array.isArray(body.deletedUsers)){
        if(!STORE.deletedUsers)STORE.deletedUsers=[];
        body.deletedUsers.forEach(function(id){
          if(!STORE.deletedUsers.includes(id)){
            STORE.deletedUsers.push(id);
            STORE.users=(STORE.users||[]).filter(function(u){return u.id!==id;});
            if(STORE.blocks&&STORE.blocks[id])delete STORE.blocks[id];
            if(STORE.tracker&&STORE.tracker[id])delete STORE.tracker[id];
          }
        });
      }
      // Merge users by email
      if(body.users) mergeUsers(body.users);
      ['settings','designations','tickets','editlog','notifications','chat'].forEach(function(k){
        if(body[k]!==undefined)STORE[k]=body[k];
      });
      STORE._ts=Date.now();
      saveStore();
      res.writeHead(200);
      res.end(JSON.stringify({ok:true,users:STORE.users.length}));
    });
    return;
  }

  if(req.method==='POST' && url==='/data'){
    readBody(req,function(body){
      if(body.deletedUsers&&Array.isArray(body.deletedUsers)){
        if(!STORE.deletedUsers)STORE.deletedUsers=[];
        body.deletedUsers.forEach(function(id){
          if(!STORE.deletedUsers.includes(id))STORE.deletedUsers.push(id);
          STORE.users=(STORE.users||[]).filter(function(u){return u.id!==id;});
        });
      }
      if(body.users) mergeUsers(body.users);
      if(body.blocks){if(!STORE.blocks)STORE.blocks={};Object.keys(body.blocks).forEach(k=>{if(!(STORE.deletedUsers||[]).includes(k))STORE.blocks[k]=body.blocks[k];});}
      if(body.tracker){if(!STORE.tracker)STORE.tracker={};Object.keys(body.tracker).forEach(k=>{if(!(STORE.deletedUsers||[]).includes(k)){if(!STORE.tracker[k])STORE.tracker[k]={};Object.assign(STORE.tracker[k],body.tracker[k]);}});}
      ['settings','designations','tickets','editlog','notifications','chat','taskAtt'].forEach(k=>{if(body[k]!==undefined)STORE[k]=body[k];});
      STORE._ts=Date.now();
      saveStore();
      res.writeHead(200);res.end(JSON.stringify({ok:true}));
    });
    return;
  }

  // Clean duplicates endpoint
  if(req.method==='POST' && url==='/clean'){
    var seen={},clean=[];
    (STORE.users||[]).forEach(function(u){
      if(!u.email||(STORE.deletedUsers||[]).includes(u.id)||u._deleted)return;
      var key=u.email.toLowerCase();
      if(!seen[key]){seen[key]=u;clean.push(u);}
      else if(u.status==='active'&&seen[key].status!=='active'){
        var i=clean.indexOf(seen[key]);clean[i]=u;seen[key]=u;
      }
    });
    var removed=STORE.users.length-clean.length;
    STORE.users=clean;
    saveStore();
    res.writeHead(200);
    res.end(JSON.stringify({ok:true,removed:removed,remaining:clean.length}));
    return;
  }

  res.writeHead(404);res.end(JSON.stringify({ok:false}));
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log('Habitly v3 on port',PORT));
