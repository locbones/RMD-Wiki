"""Make temporary model-section and neutral-clip preview files with Nexus.

Multi-section models are split into distinct body sections for portrait export.
The combined D2R animation archives include additive clips which cannot bind
as a full-body preview. Only the neutral clip is passed to Nexus's exporter.
Packed layouts and SDK signatures follow Granny file_info/data_tree_writer.
The game file is never written back.
"""
import ctypes as c,sys,json
from pathlib import Path
P=c.c_void_p
class Variant(c.Structure):
    _pack_=1;_fields_=[('type',P),('object',P)]
class Info(c.Structure):
    _pack_=1
    _fields_=[('art',P),('exporter',P),('filename',P)]+sum(([(k+'_count',c.c_int32),(k,P)]for k in ['textures','materials','skeletons','vertices','topologies','meshes','models','tracks','animations']),[])+[('extended',Variant)]
class Transform(c.Structure):
    _pack_=1;_fields_=[('flags',c.c_int32),('position',c.c_float*3),('orientation',c.c_float*4),('scale',c.c_float*9)]
class Model(c.Structure):
    _pack_=1;_fields_=[('name',c.c_char_p),('skeleton',P),('placement',Transform),('count',c.c_int32),('bindings',P),('extended',Variant)]
def extract(library,source,target,mode='animation'):
    dll=c.CDLL(str(library))
    def api(name,args,ret):
        f=getattr(dll,name);f.argtypes=args;f.restype=ret;return f
    read=api('GrannyReadEntireFile',[c.c_char_p],P)
    get=api('GrannyGetFileInfo',[P],c.POINTER(Info))
    rootfn=api('GrannyGetDataTreeFromFile',[P,c.POINTER(Variant)],None)
    begin=api('GrannyBeginFileDataTreeWriting',[P,P,c.c_int32,c.c_int32],P)
    write=api('GrannyWriteDataTreeToFile',[P,c.c_uint32,P,c.c_char_p,c.c_int32],c.c_bool)
    end=api('GrannyEndFileDataTreeWriting',[P],None)
    free=api('GrannyFreeFile',[P],None)
    file=read(str(source).encode());assert file,'Cannot read combined animation file'
    info=get(file);assert info,'Invalid file info'
    if mode=='portrait-parts':
        # Nexus exports the first model with bindings. D2R often stores several
        # distinct body sections (and duplicate references) in the same file.
        # Write one temporary input per unique binding list, without altering
        # any mesh, material, skeleton or original game input.
        folder=Path(target);folder.mkdir(parents=True,exist_ok=True)
        pointers=c.cast(info.contents.models,c.POINTER(P));parts=[];chosen={}
        vertex_count=api('GrannyGetMeshVertexCount',[P],c.c_int32)
        for i in range(info.contents.models_count):
            model=c.cast(pointers[i],c.POINTER(Model)).contents
            assert 0<=model.count<4096,'Invalid model bindings'
            if not model.count:continue
            bindings=c.cast(model.bindings,c.POINTER(P));names=tuple(c.cast(bindings[n],c.POINTER(c.c_char_p))[0].decode(errors='replace')for n in range(model.count));size=sum(vertex_count(bindings[n])for n in range(model.count))
            signature=tuple(sorted(names))
            if signature not in chosen or size>chosen[signature][2]:chosen[signature]=(pointers[i],names,size)
        for pointer,names,size in chosen.values():
            model=c.cast(pointer,c.POINTER(Model)).contents
            array=(P*1)(pointer);info.contents.models_count=1;info.contents.models=c.cast(array,P)
            output=folder/('part-'+str(len(parts))+'.gr2')
            root=Variant();rootfn(file,c.byref(root));writer=begin(root.type,root.object,0,0);assert writer
            magic=(c.c_ubyte*32).from_buffer_copy(Path(source).read_bytes()[:32])
            ok=write(writer,0x80000037,c.cast(magic,P),str(output).encode(),8);end(writer)
            if not ok:raise ValueError('Cannot write portrait model section')
            parts.append({'file':output.name,'name':model.name.decode(errors='replace'),'meshNames':names,'vertices':size})
        (folder/'parts.json').write_text(json.dumps(parts));free(file);print(str(len(parts))+' model sections');return
    if mode=='model-root':
        assert 0<info.contents.models_count<256,'Invalid model layout'
        pointers=c.cast(info.contents.models,c.POINTER(P));root_name=c.create_string_buffer(b'root')
        for i in range(info.contents.models_count):c.cast(pointers[i],c.POINTER(P))[0]=c.cast(root_name,P)
        selected='root model binding'
    else:
        assert 0<info.contents.animations_count<4096,'Invalid animation layout'
        pointers=c.cast(info.contents.animations,c.POINTER(P))
        names=[c.cast(pointers[i],c.POINTER(c.c_char_p))[0].decode(errors='replace')for i in range(info.contents.animations_count)]
        requested=mode.split(':',1)[1]if mode.startswith('animation:')else None
        index=next((i for i,n in enumerate(names)if n.lower()==requested.lower()),None)if requested else next((i for i,n in enumerate(names)if n.lower()in ['neutral','idle']),None)
        if index is None:index=next((i for i,n in enumerate(names)if 'neutral'in n.lower()and'additive'not in n.lower()),None)
        if index is None:raise ValueError('No neutral animation in '+str(source)+'; available: '+', '.join(names))
        array=(P*1)(pointers[index]);info.contents.animations_count=1;info.contents.animations=c.cast(array,P);selected=names[index]
    root=Variant();rootfn(file,c.byref(root));writer=begin(root.type,root.object,0,0);assert writer
    # Reuse the input platform's magic value; files have already been decompressed.
    magic=(c.c_ubyte*32).from_buffer_copy(Path(source).read_bytes()[:32])
    ok=write(writer,0x80000037,c.cast(magic,P),str(target).encode(),8);end(writer);free(file)
    if not ok:raise ValueError('Cannot write neutral preview clip')
    print(selected)
if __name__=='__main__':extract(*sys.argv[1:])
