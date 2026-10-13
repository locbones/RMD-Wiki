"""Render decoded D2RNexus geometry to portable Bestiary portraits.

All game inputs are read-only. Granny decoding and texture parsing use the
user's Nexus backend. An offscreen OpenGL framebuffer produces the stills.
"""
import os,sys,json,hashlib,subprocess,struct,time,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'.tmp/bestiary-python'))
NEXUS=Path(os.environ.get('RMD_NEXUS','C:/Users/djsch/Github/D2RNexus/vendor/ModelConverter'))
sys.path.insert(0,str(NEXUS))
import numpy as np
import moderngl
from PIL import Image
from preview import decode_texture

CONFIG=json.loads((ROOT/'scripts/items/sources.json').read_text())
ROOTS=[Path(os.environ.get('RMD_MOD_DATA',CONFIG['mod'])),Path(os.environ.get('RMD_ARCHIVE_DATA',CONFIG['archive']))]
NATIVE=NEXUS/'resources/native'
CACHE=ROOT/'.tmp/bestiary-render';CACHE.mkdir(parents=True,exist_ok=True)
def resolve(relative):
    if not relative:return None
    rel=str(relative).replace('\\','/').removeprefix('data/')
    return next((p/rel for p in ROOTS if (p/rel).is_file()),None)
def run(args):
    result=subprocess.run([str(a)for a in args],capture_output=True,text=True,creationflags=0x08000000)
    if result.returncode:raise RuntimeError(result.stdout+result.stderr)
def decompress(file):
    if not file:return '-'
    key=hashlib.sha256(file.read_bytes()).hexdigest();target=CACHE/(key+'.gr2')
    if not target.is_file():run([NATIVE/'granny_backend.exe','Decompress',file,target])
    return target
idle_clips={}
def idle_clip(asset):
    if asset['key']in idle_clips:return idle_clips[asset['key']]
    errors=[]
    for candidate in [{'path':asset['animation'],'clip':None}]+asset.get('idleAlternates',[]):
        anim=decompress(resolve(candidate['path']));suffix='-neutral'if not candidate['clip']else'-'+candidate['clip']
        clip=Path(str(anim).replace('.gr2',suffix+'.gr2'))
        try:
            if not clip.is_file():run([sys.executable,ROOT/'scripts/bestiary/neutral_clip.py',NATIVE/'granny2_x64.dll',anim,clip,'animation:'+candidate['clip']if candidate['clip']else'animation'])
            idle_clips[asset['key']]=clip;return clip
        except Exception as error:errors.append(str(error))
    raise ValueError('; '.join(errors))

def sections(model,asset):
    decoded=decompress(resolve(model));folder=Path(str(decoded).removesuffix('.gr2')+'-parts-v2')
    if not (folder/'parts.json').exists():run([sys.executable,ROOT/'scripts/bestiary/neutral_clip.py',NATIVE/'granny2_x64.dll',decoded,folder,'portrait-parts'])
    scenes=[]
    for part in json.loads((folder/'parts.json').read_text()):
        # Meshes named as organs/intestinal fragments are death attachments.
        if all(re.search(r'intestine|^organ|gore|fragment|_cut',name,re.I)for name in part['meshNames']):continue
        output=folder/(part['file']+'-scene')
        if not (output/'scene.json').exists():run([NATIVE/'granny_viewer_export.exe',folder/part['file'],'-','-',output])
        scene=json.loads((output/'scene.json').read_text())
        if asset.get('animation') and asset.get('skeleton'):
            rig=decompress(resolve(asset['skeleton']));clip=idle_clip(asset)
            posed=output/('idle-v2-'+hashlib.sha256((str(rig)+str(clip)).encode()).hexdigest()[:16]+'.npy')
            if not posed.is_file():run([sys.executable,ROOT/'scripts/bestiary/idle_pose.py',NATIVE/'granny2_x64.dll',folder/part['file'],rig,clip,posed])
            scene['idle']=np.load(posed);scene['idleInfo']=json.loads(Path(str(posed)+'.json').read_text())
        scenes.append((output,scene))
    return scenes
def transform(definition):
    definition=definition or {};scale=definition.get('scale',{});pos=definition.get('position',{});q=definition.get('orientation',{})
    x,y,z,w=[q.get(k,1 if k=='w'else 0)for k in ['x','y','z','w']]
    matrix=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w,0],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w,0],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y,0],[0,0,0,1]],dtype='f4')
    matrix[:3,:3]=matrix[:3,:3]@np.diag([scale.get(k,1)for k in ['x','y','z']]);matrix[:3,3]=[pos.get(k,0)for k in ['x','y','z']]
    return matrix
def mesh_data(folder,scene,mesh,item,root):
    vertices=np.fromfile(folder/mesh['vertices'],dtype='<f4').reshape(-1,16)
    position=np.concatenate([vertices[:,:3],np.ones((len(vertices),1))],axis=1)
    normal=vertices[:,3:6]
    if item.get('skinned',True) and 'idle'in scene:
        matrices=scene['idle']
        skin=np.sum(matrices[vertices[:,12:16].astype(int)]*vertices[:,8:12,None,None],axis=1)
        position=np.einsum('nij,nj->ni',skin,position)
        normal=np.einsum('nij,nj->ni',skin[:,:3,:3],normal)
    local=transform(item.get('transform'));world=transform(root)@local
    position=position@world.T;normal=normal@np.linalg.inv(world[:3,:3])
    normal/=np.maximum(np.linalg.norm(normal,axis=1,keepdims=True),1e-6)
    return np.concatenate([position[:,:3],normal,vertices[:,6:8]],axis=1).astype('f4')

ctx=moderngl.create_standalone_context(require=330)
program=ctx.program(vertex_shader='''#version 330
in vec3 position;in vec3 normal;in vec2 uv;uniform mat4 matrix;out vec3 vNormal;out vec2 vUV;
void main(){gl_Position=matrix*vec4(position,1);vNormal=normal;vUV=uv;}
''',fragment_shader='''#version 330
in vec3 vNormal;in vec2 vUV;uniform sampler2D albedo;uniform bool srgb;out vec4 color;
void main(){vec4 tex=texture(albedo,vUV);if(tex.a<.4)discard;vec3 a=tex.rgb;if(srgb)a=mix(a/12.92,pow((a+.055)/1.055,vec3(2.4)),step(vec3(.04045),a));float light=.65+.35*max(0.,dot(normalize(vNormal),normalize(vec3(.35,.8,.5))));color=vec4(pow(a*light*1.25,vec3(1./2.2)),1.);}
''')
size=960
fbo=ctx.framebuffer(ctx.texture((size,size),4),ctx.depth_renderbuffer((size,size)))
ctx.enable(moderngl.DEPTH_TEST)
textures={}
def texture(folder,group):
    key=group.get('embedded')or group.get('texture')or 'none'
    cache_key=(str(folder)if group.get('embedded')else '',key)
    if cache_key in textures:return textures[cache_key]
    if group.get('embedded'):
        image=Image.frombytes('RGBA',(group['width'],group['height']),(folder/group['embedded']).read_bytes());srgb=True
    elif group.get('texture'):
        path=resolve(group['texture'])
        if not path:raise ValueError('Missing texture: '+group['texture'])
        image=decode_texture(path);kind=struct.unpack_from('<H',path.read_bytes(),4)[0];srgb=kind in [32,58,62]
    else:image=Image.new('RGBA',(1,1),(145,136,125,255));srgb=True
    image.thumbnail((2048,2048));tx=ctx.texture(image.size,4,image.tobytes());tx.build_mipmaps();tx.filter=(moderngl.LINEAR_MIPMAP_LINEAR,moderngl.LINEAR)
    textures[cache_key]=(tx,srgb)
    return tx,srgb
def render(asset):
    pieces=[];warnings=[];poses=[]
    for item in asset['models']:
        try:
            scenes=sections(item['path'],asset)
            for folder,scene in scenes:
                if 'idleInfo'in scene:poses.append(scene['idleInfo'])
                alive=[m for m in scene['meshes']if not re.search(r'(?:^|[_\s])(?:death|dead)(?:[_\d]|Shape|$)|gore|_cut|fragment|carapace_split|body_minus_carapace|goo_|goop|^organ',m['name'],re.I)]
                # Some intact bodies are named *_dead despite containing living
                # material groups. Keep torso/shell geometry in that case.
                for mesh in scene['meshes']:
                    if mesh not in alive and not re.search(r'torso|shell|lowerbody',mesh['name'],re.I):continue
                    data=mesh_data(folder,scene,mesh,item,asset.get('transform'))
                    indices=np.fromfile(folder/mesh['indices'],dtype='<u4')
                    pieces.append((data,indices,folder,mesh))
        except Exception as error:warnings.append(item['path']+': '+str(error).strip())
    if not pieces:raise ValueError('; '.join(warnings)or'No decoded meshes')
    # Consistent orthographic three-quarter view, framed around actual geometry.
    yaw=.55;pitch=.12
    z=np.array([np.sin(yaw)*np.cos(pitch),np.sin(pitch),np.cos(yaw)*np.cos(pitch)])
    x=np.cross([0,1,0],z);x/=np.linalg.norm(x);y=np.cross(z,x)
    rotation=np.array([x,y,z],dtype='f4')
    points=np.concatenate([p[0][:,:3]for p in pieces])@rotation.T
    lo=points.min(0);hi=points.max(0);center=(lo+hi)/2
    extent=max(hi[0]-lo[0],hi[1]-lo[1],.001)*1.12;depth=max(hi[2]-lo[2],extent)
    matrix=np.eye(4,dtype='f4');matrix[:3,:3]=np.diag([2/extent,2/extent,-1/depth])@rotation;matrix[:3,3]=-np.diag([2/extent,2/extent,-1/depth])@center
    program['matrix'].write(matrix.T.tobytes());program['albedo']=0
    fbo.use();fbo.clear(0,0,0,0,depth=1)
    triangles=0;missing=0
    for data,indices,folder,mesh in pieces:
        vb=ctx.buffer(data.tobytes());ib=ctx.buffer(indices.tobytes());vao=ctx.vertex_array(program,[(vb,'3f 3f 2f','position','normal','uv')],ib,index_element_size=4)
        for group in mesh['groups']:
            if re.search(r'(?:^|[_/])(?:death|dead)(?:[_\d.]|$)|gore',group.get('texture',''),re.I):continue
            try:tx,srgb=texture(folder,group)
            except Exception as error:
                warnings.append(str(error));missing+=1;tx,srgb=texture(folder,{})
            tx.use(0);program['srgb']=srgb;vao.render(moderngl.TRIANGLES,vertices=group['count'],first=group['first']);triangles+=group['count']//3
        vao.release();vb.release();ib.release()
    image=Image.frombytes('RGBA',(size,size),fbo.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).resize((480,480),Image.Resampling.LANCZOS)
    alpha=image.getchannel('A');coverage=np.count_nonzero(np.asarray(alpha)>50)/(480*480)
    if coverage<.001:raise ValueError('Empty render')
    relative=('.tmp/bestiary-idle-preview/'+asset['key']+'.webp')if '--preview'in sys.argv else asset['output']
    output=ROOT/relative;output.parent.mkdir(parents=True,exist_ok=True);image.save(output,'WEBP',quality=90,method=6)
    return {'key':asset['key'],'output':relative,'width':480,'height':480,'triangles':triangles,'coverage':round(coverage,4),'warnings':warnings,'missingTextures':missing,'renderer':'D2RNexus Granny backend + offscreen OpenGL','version':4,'pose':'Idle'if poses else'Static','animationSamples':poses,'gpu':ctx.info['GL_RENDERER']}

manifest=json.loads((ROOT/'.tmp/bestiary-prepared.json').read_text(encoding='utf8'))
selected=manifest['media']
if '--units'in sys.argv:selected=[a for a in selected if a['unit']in sys.argv[sys.argv.index('--units')+1].split(',')]
if '--limit' in sys.argv:selected=selected[:int(sys.argv[sys.argv.index('--limit')+1])]
report_file=ROOT/('.tmp/bestiary-idle-preview.json'if '--preview'in sys.argv else'data/bestiary-media.json');report_file.parent.mkdir(exist_ok=True)
previous=json.loads(report_file.read_text())if report_file.exists()else []
results={r['key']:r for r in previous}
start=time.time()
for i,asset in enumerate(selected):
    if '--force'not in sys.argv and asset['key']in results and results[asset['key']].get('version')==4 and results[asset['key']].get('output')and (ROOT/results[asset['key']]['output']).is_file():continue
    try:result=render(asset)
    except Exception as error:result={'key':asset['key'],'error':str(error)}
    results[asset['key']]=result
    report_file.write_text(json.dumps(list(results.values()),indent=2)+'\n')
    print(f"{i+1}/{len(selected)} {asset['unit']}: {'OK'if 'output'in result else result['error'][:160]} ({time.time()-start:.0f}s)",flush=True)
ctx.release()
