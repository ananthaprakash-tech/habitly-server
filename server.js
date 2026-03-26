// Habitly Server v4 - Persistent, Never Loses Data
const http = require('http');
const fs = require('fs');
const path = require('path');

// Use /tmp for Render (persists between requests, cleared on restart)
const DB_FILE = '/tmp/habitly_db.json';
const DB_BACKUP = '/tmp/habitly_db_backup.json';
const DIR = __dirname;

let STORE = {
  users:[], settings:{}, designations:[], tickets:[], editlog:[],
  notifications:[], chat:{rooms:{}}, blocks:{}, tracker:{}, taskAtt:{},
  deletedUsers:[], _ts:0
};

// Load data with fallback to backup
function loadData(){
  var files=[DB_FILE, DB_BACKUP];
  for(var i=0;i<files.length;i++){
    try{
      if(fs.existsSync(files[i])){
        var d=JSON.parse(fs.readFileSync(files[i],'utf8'));
        if(d.users&&d.users.length>0){
          STORE=d;
          if(!STORE.deletedUsers)STORE.deletedUsers=[];
          if(!STORE.blocks)STORE.blocks={};
          if(!STORE.tracker)STORE.tracker={};
          console.log('Loaded from',files[i],'- Users:',STORE.users.length);
          // Clean duplicates on load
          cleanUsers();
          return;
        }
      }
    }catch(e){console.log('Load error from',files[i],e.message);}
  }
  console.log('Starting fresh');
}

function cleanUsers(){
  var seen={},clean=[];
  (STORE.users||[]).forEach(function(u){
    if(!u||!u.email)return;
    if((STORE.deletedUsers||[]).includes(u.id)||u._deleted)return;
    var key=u.email.toLowerCase();
    if(!seen[key]){seen[key]=u;clean.push(u);}
    else if(u.status==='active'&&seen[key].status!=='active'){
      clean[clean.indexOf(seen[key])]=u;seen[key]=u;
    }
  });
  if(clean.length<(STORE.users||[]).length)console.log('Removed',(STORE.users.length-clean.length),'duplicates');
  STORE.users=clean;
}

function saveData(){
  try{
    var d=JSON.stringify(STORE);
    fs.writeFileSync(DB_FILE,d);
    // Always keep a backup
    try{fs.writeFileSync(DB_BACKUP,d);}catch(e){}
  }catch(e){console.error('Save error:',e.message);}
}

loadData();
// Save every 30 seconds as extra backup
setInterval(saveData,30000);

function mergeUsers(incoming){
  if(!Array.isArray(incoming))return;
  if(!STORE.users)STORE.users=[];
  incoming.forEach(function(u){
    if(!u||!u.email)return;
    if((STORE.deletedUsers||[]).includes(u.id)||u._deleted)return;
    var key=u.email.toLowerCase();
    var ex=STORE.users.find(function(x){return x.id===u.id;})||
           STORE.users.find(function(x){return x.email&&x.email.toLowerCase()===key;});
    if(!ex){
      STORE.users.push(u);
    } else {
      // Keep higher _localEdit wins
      var localEdit=ex._localEdit||0;
      var incomingEdit=u._localEdit||0;
      if(incomingEdit>=localEdit){
        var keepStatus=ex.status==='active'?'active':u.status;
        Object.assign(ex,u);
        ex.status=keepStatus; // Never downgrade status
      }
    }
  });
}

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

function readBody(req,cb){
  var body='';
  req.on('data',function(c){body+=c;});
  req.on('end',function(){try{cb(JSON.parse(body));}catch(e){cb({});}});
}

function serveFile(res,filepath,ct){
  try{
    var data=fs.readFileSync(filepath);
    res.setHeader('Content-Type',ct);
    res.setHeader('Cache-Control','no-cache');
    res.writeHead(200);res.end(data);
    return true;
  }catch(e){return false;}
}

var server=http.createServer(function(req,res){
  cors(res);
  if(req.method==='OPTIONS'){res.writeHead(200);res.end();return;}
  var url=req.url.split('?')[0];

  // Health check - keeps server alive
  if(req.method==='GET'&&url==='/health'){
    res.setHeader('Content-Type','application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ok:true,users:STORE.users.length,ts:STORE._ts}));
    return;
  }

  // Serve PWA files
  if(req.method==='GET'&&url==='/manifest.json'){
    res.setHeader('Content-Type','application/manifest+json');
    res.writeHead(200);
    res.end(JSON.stringify({name:'Habitly',short_name:'Habitly',start_url:'/',display:'standalone',background_color:'#1A1C20',theme_color:'#1A1C20',icons:[{src:'icon-192.png',sizes:'192x192',type:'image/png'},{src:'icon-512.png',sizes:'512x512',type:'image/png'}]}));
    return;
  }
  if(req.method==='GET'&&url==='/sw.js'){serveFile(res,path.join(DIR,'sw.js'),'application/javascript')||(res.writeHead(200)&&res.end(''));return;}
  if(req.method==='GET'&&url==='/icon-192.png'){serveFile(res,path.join(DIR,'icon-192.png'),'image/png')||(res.writeHead(404)&&res.end());return;}
  if(req.method==='GET'&&url==='/icon-512.png'){serveFile(res,path.join(DIR,'icon-512.png'),'image/png')||(res.writeHead(404)&&res.end());return;}

  // Main app
  if(req.method==='GET'&&(url==='/'||url==='/index.html'||url==='/app')){
    if(!serveFile(res,path.join(DIR,'index.html'),'text/html;charset=utf-8')){
      res.writeHead(200);
      res.end('<html><body><h2>Loading... Please wait and refresh in 30 seconds.</h2><script>setTimeout(()=>location.reload(),10000)</script></body></html>');
    }
    return;
  }

  res.setHeader('Content-Type','application/json');

  // Get all data
  if(req.method==='GET'&&url.startsWith('/data')){
    var safeStore=JSON.parse(JSON.stringify(STORE));
    // Never send deleted/rejected users
    safeStore.users=(STORE.users||[]).filter(function(u){
      return !u._deleted&&!(STORE.deletedUsers||[]).includes(u.id);
    });
    res.writeHead(200);
    res.end(JSON.stringify({ok:true,data:safeStore}));
    return;
  }

  // Push user's own blocks/tracker
  if(req.method==='POST'&&url==='/sync/user'){
    readBody(req,function(body){
      var uid=body.userId;
      if(!uid||(STORE.deletedUsers||[]).includes(uid)){res.writeHead(200);res.end(JSON.stringify({ok:true}));return;}
      if(!STORE.blocks)STORE.blocks={};
      if(!STORE.tracker)STORE.tracker={};
      // Only update if incoming has data (never wipe with empty)
      if(body.blocks&&body.blocks.length>0)STORE.blocks[uid]=body.blocks;
      if(body.tracker&&Object.keys(body.tracker).length>0){
        if(!STORE.tracker[uid])STORE.tracker[uid]={};
        Object.assign(STORE.tracker[uid],body.tracker);
      }
      if(body.taskAtt)Object.assign(STORE.taskAtt||(STORE.taskAtt={}),body.taskAtt);
      STORE._ts=Date.now();
      saveData();
      res.writeHead(200);res.end(JSON.stringify({ok:true}));
    });
    return;
  }

  // Push shared data (users, settings, etc)
  if(req.method==='POST'&&url==='/sync/shared'){
    readBody(req,function(body){
      // Handle deletions
      if(body.deletedUsers&&Array.isArray(body.deletedUsers)){
        if(!STORE.deletedUsers)STORE.deletedUsers=[];
        body.deletedUsers.forEach(function(id){
          if(!STORE.deletedUsers.includes(id)){
            STORE.deletedUsers.push(id);
            STORE.users=(STORE.users||[]).filter(function(u){return u.id!==id;});
            delete (STORE.blocks||{})[id];
            delete (STORE.tracker||{})[id];
          }
        });
      }
      if(body.users)mergeUsers(body.users);
      ['settings','designations','tickets','editlog','notifications'].forEach(function(k){
        if(body[k]!==undefined)STORE[k]=body[k];
      });
      // Merge chat
      if(body.chat&&body.chat.rooms){
        if(!STORE.chat)STORE.chat={rooms:{}};
        Object.keys(body.chat.rooms).forEach(function(rid){
          if(!STORE.chat.rooms[rid])STORE.chat.rooms[rid]=body.chat.rooms[rid];
          else{
            var lm=STORE.chat.rooms[rid].messages||[];
            var sm=body.chat.rooms[rid].messages||[];
            var ids=new Set(lm.map(function(m){return m.id;}));
            sm.forEach(function(m){if(!ids.has(m.id))lm.push(m);});
            lm.sort(function(a,b){return(a.ts||0)-(b.ts||0);});
            STORE.chat.rooms[rid].messages=lm;
          }
        });
      }
      STORE._ts=Date.now();
      saveData();
      res.writeHead(200);
      res.end(JSON.stringify({ok:true,users:STORE.users.length}));
    });
    return;
  }

  res.writeHead(404);res.end(JSON.stringify({ok:false}));
});

var PORT=process.env.PORT||3000;
server.listen(PORT,function(){console.log('Habitly v4 on port',PORT);});
