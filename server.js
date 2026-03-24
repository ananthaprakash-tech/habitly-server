const http=require('http');
const fs=require('fs');
const path=require('path');
const DIR=__dirname;
const DB_FILE=path.join('/tmp','habitly_db.json');

let STORE={users:[],settings:{},designations:[],tickets:[],editlog:[],notifications:[],chat:{rooms:{}},blocks:{},tracker:{},taskAtt:{},deletedUsers:[],_ts:0};

// Load existing data
try{
  if(fs.existsSync(DB_FILE)){
    STORE=JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
    if(!STORE.deletedUsers)STORE.deletedUsers=[];
    if(!STORE.blocks)STORE.blocks={};
    if(!STORE.tracker)STORE.tracker={};
    // Remove deleted users
    STORE.users=(STORE.users||[]).filter(function(u){
      return !u._deleted&&!(STORE.deletedUsers||[]).includes(u.id);
    });
    // Dedupe by email - keep active over pending
    var seen={},clean=[];
    STORE.users.forEach(function(u){
      if(!u.email)return;
      var k=u.email.toLowerCase();
      if(!seen[k]){seen[k]=u;clean.push(u);}
      else if(u.status==='active'&&seen[k].status!=='active'){
        clean[clean.indexOf(seen[k])]=u;seen[k]=u;
      }
    });
    STORE.users=clean;
    console.log('Loaded. Users:',STORE.users.length);
  }
}catch(e){console.log('Fresh start');}

function save(){try{fs.writeFileSync(DB_FILE,JSON.stringify(STORE));}catch(e){}}

// Merge users - only add new, never update existing status/permissions
function mergeUsers(incoming){
  if(!Array.isArray(incoming))return;
  incoming.forEach(function(u){
    if(!u.email)return;
    if((STORE.deletedUsers||[]).includes(u.id)||u._deleted)return;
    var k=u.email.toLowerCase();
    var ex=STORE.users.find(function(x){return x.id===u.id;})||
           STORE.users.find(function(x){return x.email&&x.email.toLowerCase()===k;});
    if(!ex){
      STORE.users.push(u);
    } else {
      // NEVER downgrade status - only allow upgrades
      var oldStatus=ex.status;
      Object.assign(ex,u);
      if(oldStatus==='active')ex.status='active'; // Never downgrade from active
    }
  });
}

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

function body(req,cb){
  let b='';
  req.on('data',c=>b+=c);
  req.on('end',()=>{try{cb(JSON.parse(b));}catch(e){cb({});}});
}

function serveFile(res,fp,ct){
  try{var d=fs.readFileSync(fp);res.setHeader('Content-Type',ct);res.setHeader('Cache-Control','no-cache');res.writeHead(200);res.end(d);return true;}
  catch(e){return false;}
}

const server=http.createServer((req,res)=>{
  cors(res);
  if(req.method==='OPTIONS'){res.writeHead(200);res.end();return;}
  const url=req.url.split('?')[0];

  // Static files
  if(req.method==='GET'&&(url==='/'||url==='/index.html')){
    if(!serveFile(res,path.join(DIR,'index.html'),'text/html;charset=utf-8')){
      res.writeHead(200);res.end('<h1>Loading...</h1><script>setTimeout(()=>location.reload(),3000)</script>');
    }
    return;
  }
  if(req.method==='GET'&&url==='/manifest.json'){serveFile(res,path.join(DIR,'manifest.json'),'application/manifest+json')||(res.writeHead(404)&&res.end());return;}
  if(req.method==='GET'&&url==='/sw.js'){serveFile(res,path.join(DIR,'sw.js'),'application/javascript')||(res.writeHead(404)&&res.end());return;}
  if(req.method==='GET'&&url==='/icon-192.png'){serveFile(res,path.join(DIR,'icon-192.png'),'image/png')||(res.writeHead(404)&&res.end());return;}
  if(req.method==='GET'&&url==='/icon-512.png'){serveFile(res,path.join(DIR,'icon-512.png'),'image/png')||(res.writeHead(404)&&res.end());return;}

  res.setHeader('Content-Type','application/json');

  if(req.method==='GET'&&url==='/health'){
    res.writeHead(200);res.end(JSON.stringify({ok:true,app:'Habitly',users:STORE.users.length,ts:STORE._ts}));return;
  }

  // GET /data - return all data, filter deleted users
  if(req.method==='GET'&&url.startsWith('/data')){
    var safeUsers=(STORE.users||[]).filter(function(u){
      return !u._deleted&&!(STORE.deletedUsers||[]).includes(u.id);
    });
    var out=Object.assign({},STORE,{users:safeUsers});
    res.writeHead(200);res.end(JSON.stringify({ok:true,data:out}));return;
  }

  // POST /sync/user - save own blocks/tracker
  if(req.method==='POST'&&url==='/sync/user'){
    body(req,function(b){
      var uid=b.userId;
      if(!uid||(STORE.deletedUsers||[]).includes(uid)){res.writeHead(200);res.end(JSON.stringify({ok:true}));return;}
      if(!STORE.blocks)STORE.blocks={};
      if(!STORE.tracker)STORE.tracker={};
      if(!STORE.taskAtt)STORE.taskAtt={};
      // Blocks: only update if incoming has data OR no existing data
      if(b.blocks!==undefined){
        var sb=b.blocks||[];
        var lb=STORE.blocks[uid]||[];
        if(sb.length>0){STORE.blocks[uid]=sb;}
        else if(lb.length===0){STORE.blocks[uid]=sb;}
        // Never wipe existing blocks with empty
      }
      // Tracker: merge by date, never overwrite existing dates
      if(b.tracker){
        if(!STORE.tracker[uid])STORE.tracker[uid]={};
        Object.keys(b.tracker).forEach(function(date){
          // Always take latest tracker data for own dates
          STORE.tracker[uid][date]=b.tracker[date];
        });
      }
      if(b.taskAtt)Object.assign(STORE.taskAtt,b.taskAtt);
      STORE._ts=Date.now();save();
      res.writeHead(200);res.end(JSON.stringify({ok:true}));
    });return;
  }

  // POST /sync/shared - save users/settings/etc
  if(req.method==='POST'&&url==='/sync/shared'){
    body(req,function(b){
      // Handle deletions
      if(b.deletedUsers&&Array.isArray(b.deletedUsers)){
        if(!STORE.deletedUsers)STORE.deletedUsers=[];
        b.deletedUsers.forEach(function(id){
          if(!STORE.deletedUsers.includes(id)){
            STORE.deletedUsers.push(id);
            STORE.users=(STORE.users||[]).filter(function(u){return u.id!==id;});
            if(STORE.blocks&&STORE.blocks[id])delete STORE.blocks[id];
            if(STORE.tracker&&STORE.tracker[id])delete STORE.tracker[id];
          }
        });
      }
      if(b.users)mergeUsers(b.users);
      ['settings','designations','tickets','editlog','notifications','chat'].forEach(function(k){
        if(b[k]!==undefined)STORE[k]=b[k];
      });
      STORE._ts=Date.now();save();
      res.writeHead(200);res.end(JSON.stringify({ok:true,users:STORE.users.length}));
    });return;
  }

  res.writeHead(404);res.end(JSON.stringify({ok:false}));
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log('Habitly server on port',PORT));
