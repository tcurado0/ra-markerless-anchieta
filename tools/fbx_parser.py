import struct, zlib, sys, json
def parse(path):
    d=open(path,'rb').read()
    assert d[:20]==b'Kaydara FBX Binary  '
    ver=struct.unpack('<I',d[23:27])[0]
    big=ver>=7500
    def rprop(o):
        t=chr(d[o]);o+=1
        if t in 'YCIFDL':
            fmt={'Y':'<h','C':'<?','I':'<i','F':'<f','D':'<d','L':'<q'}[t]
            v=struct.unpack_from(fmt,d,o)[0];return v,o+struct.calcsize(fmt)
        if t in 'fdlib':
            n,enc,cl=struct.unpack_from('<III',d,o);o+=12
            raw=d[o:o+cl];o+=cl
            if enc==1: raw=zlib.decompress(raw)
            fmt={'f':'f','d':'d','l':'q','i':'i','b':'?'}[t]
            return list(struct.unpack('<%d%s'%(n,fmt),raw)),o
        if t in 'SR':
            n=struct.unpack_from('<I',d,o)[0];o+=4
            v=d[o:o+n];o+=n
            return (v.decode('utf8','replace') if t=='S' else v),o
        raise Exception('type '+t)
    def rnode(o):
        if big: end,np_,pl=struct.unpack_from('<QQQ',d,o);o+=24
        else: end,np_,pl=struct.unpack_from('<III',d,o);o+=12
        nl=d[o];o+=1
        if end==0: return None,o
        name=d[o:o+nl].decode();o+=nl
        props=[]
        for _ in range(np_):
            v,o=rprop(o);props.append(v)
        ch=[]
        while o<end:
            c,o2=rnode(o)
            if c is None: o=o2;break
            ch.append(c);o=o2
        return {'n':name,'p':props,'c':ch},end
    o=27;nodes=[]
    while o<len(d)-200:
        n,o2=rnode(o)
        if n is None: break
        nodes.append(n);o=o2
    return ver,nodes
def dump(n,ind=0,out=sys.stdout):
    ps=[]
    for p in n['p']:
        if isinstance(p,list): ps.append('[%d items]'%len(p))
        elif isinstance(p,bytes): ps.append('<%dB>'%len(p))
        else: ps.append(repr(p)[:60])
    print('  '*ind+n['n'],', '.join(ps),file=out)
    for c in n['c']: dump(c,ind+1,out)
if __name__=='__main__':
    v,ns=parse(sys.argv[1]);print('version',v)
    for n in ns: dump(n)
