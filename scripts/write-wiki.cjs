// Stage the complete single-file wiki before replacing it. Windows readers can
// briefly hold the file open; a failed replacement leaves the old wiki intact.
const fs=require('node:fs');
const path=require('node:path');
module.exports=function writeWiki(file,next,expected) {
  const directory=path.join(path.dirname(file),'.tmp');
  fs.mkdirSync(directory,{recursive:true});
  const staged=path.join(directory,'next-index-'+process.pid+'.html');
  fs.writeFileSync(staged,next);
  if(fs.readFileSync(file,'utf8')!==expected)throw new Error('The wiki changed during the build. Re-run against the latest saved file. Staged output: '+staged);
  for(let attempt=0;attempt<5;attempt++) {
    try {fs.renameSync(staged,file);return;}
    catch(error) {
      if(attempt===4||!['UNKNOWN','EPERM','EBUSY','EACCES'].includes(error.code))throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);
    }
  }
};
