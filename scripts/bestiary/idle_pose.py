"""Sample Nexus/Granny idle animation; retain each body section's skin bindings."""
import ctypes as c,json,sys
from pathlib import Path
from neutral_clip import P,Info,Model,Transform,Variant
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'.tmp/bestiary-python'))
import numpy as np
class Bone(c.Structure):
    _pack_=1;_fields_=[('name',c.c_char_p),('parent',c.c_int32),('local',Transform),('inverse',c.c_float*16),('lod',c.c_float),('extended',Variant)]
class Skeleton(c.Structure):
    _pack_=1;_fields_=[('name',c.c_char_p),('count',c.c_int32),('bones',c.POINTER(Bone)),('lod',c.c_int32),('extended',Variant)]
class Animation(c.Structure):
    _pack_=1;_fields_=[('name',c.c_char_p),('duration',c.c_float),('timestep',c.c_float),('oversampling',c.c_int32),('count',c.c_int32),('groups',P)]
def sample(library,model_file,skeleton_file,animation_file,target):
    dll=c.CDLL(str(library))
    def api(name,args,ret):
        fn=getattr(dll,name);fn.argtypes=args;fn.restype=ret;return fn
    read=api('GrannyReadEntireFile',[c.c_char_p],P);get=api('GrannyGetFileInfo',[P],c.POINTER(Info))
    files=[read(str(f).encode()) for f in [model_file,skeleton_file,animation_file]];assert all(files)
    infos=[get(f).contents for f in files]
    model=c.cast(c.cast(infos[0].models,c.POINTER(P))[0],c.POINTER(Model)).contents
    embedded=c.cast(model.skeleton,c.POINTER(Skeleton)).contents
    rig_pointer=c.cast(infos[1].skeletons,c.POINTER(P))[0];rig=c.cast(rig_pointer,c.POINTER(Skeleton)).contents
    animation_pointer=c.cast(infos[2].animations,c.POINTER(P))[0];animation=c.cast(animation_pointer,c.POINTER(Animation)).contents
    assert 0<rig.count<2048 and 0<embedded.count<2048
    # The animation belongs to the complete unit, while meshes retain their own
    # section rigs. Bind it to root, then map the sampled bones by name.
    root_model=Model();root_model.name=b'root';root_model.skeleton=rig_pointer
    root_model.placement.flags=7;root_model.placement.orientation[3]=1
    for i in range(3):root_model.placement.scale[i*3+i]=1
    instance=api('GrannyInstantiateModel',[c.POINTER(Model)],P)(c.byref(root_model));assert instance
    local=api('GrannyNewLocalPose',[c.c_int32],P)(rig.count)
    world=api('GrannyNewWorldPose',[c.c_int32],P)(rig.count)
    build=api('GrannyBuildWorldPose',[P,c.c_int32,c.c_int32,P,P,P],None)
    get_world=api('GrannyGetWorldPose4x4',[P,c.c_int32],c.POINTER(c.c_float))
    control=api('GrannyPlayControlledAnimation',[c.c_float,P,P],P)(0,animation_pointer,instance);assert control
    api('GrannySetControlLoopCount',[P,c.c_int32],None)(control,0)
    time=animation.duration*.25
    api('GrannySetModelClock',[P,c.c_float],None)(instance,time)
    api('GrannySampleModelAnimations',[P,c.c_int32,c.c_int32,P],None)(instance,0,rig.count,local)
    build(rig_pointer,0,rig.count,local,None,world)
    lookup={rig.bones[i].name.decode():i for i in range(rig.count)}
    full_world=[np.ctypeslib.as_array(get_world(world,i),shape=(16,)).copy().reshape(4,4) for i in range(rig.count)]
    matrices=[];missing=[];section_world=[]
    compose=api('GrannyBuildCompositeTransform4x4',[c.POINTER(Transform),c.POINTER(c.c_float)],None)
    for b in embedded.bones[:embedded.count]:
        name=b.name.decode();index=lookup.get(name)
        if index is None:
            # Unanimated section bones (e.g. Fetish Shaman's jaw) still follow
            # their animated parent, using the section's own local transform.
            matrix=(c.c_float*16)();compose(c.byref(b.local),matrix)
            posed=np.array(matrix).reshape(4,4)
            if b.parent>=0:posed=posed@section_world[b.parent]
            missing.append(name)
        else:posed=full_world[index]
        section_world.append(posed)
        inverse=np.array(b.inverse).reshape(4,4)
        matrices.append((inverse@posed).T)
    np.save(target,np.array(matrices,dtype='f4'))
    Path(str(target)+'.json').write_text(json.dumps({'clip':animation.name.decode(),'time':time,'duration':animation.duration,'inheritedBones':missing,'poseDifference':float(np.max(np.abs(np.array(matrices)-np.eye(4))))}))
    print(json.dumps({'clip':animation.name.decode(),'bones':embedded.count,'missing':missing,'maxTransform':float(np.max(np.abs(matrices)))}))
if __name__=='__main__':sample(*sys.argv[1:])
