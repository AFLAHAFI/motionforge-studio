"""Integration checks against a running local server; Python stdlib + ffprobe/ffmpeg."""
import json, urllib.request, urllib.error, struct, zlib, time, subprocess, tempfile, wave, math, io
from pathlib import Path
BASE='http://localhost:4173'
OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def request(path,method='GET',data=None,token=None,headers=None):
    hdr=headers or {}
    if token: hdr['X-MotionForge-Token']=token
    if isinstance(data,dict): data=json.dumps(data).encode();hdr['Content-Type']='application/json'
    req=urllib.request.Request(BASE+path,data=data,method=method,headers=hdr)
    with OPENER.open(req,timeout=30) as response: return response.read()
def png(w,h,step):
    def chunk(name,data): return struct.pack('>I',len(data))+name+data+struct.pack('>I',zlib.crc32(name+data)&0xffffffff)
    rows=[]
    for y in range(h):
        row=bytearray(w*4)
        if h//3<y<h*2//3:
            left=w//4+step*w//48;right=min(w,left+w//5)
            row[left*4:right*4]=bytes((255,20,30,180))*(right-left)
        rows.append(b'\0'+row)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),3))+chunk(b'IEND',b'')
def tone():
    out=io.BytesIO()
    with wave.open(out,'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000)
        f.writeframes(b''.join(struct.pack('<h',int(math.sin(i*2*math.pi*440/16000)*4000)) for i in range(11200)))
    return out.getvalue()
token=json.loads(request('/api/diagnostics'))['token']
checks=[]
def expect_rejection(path,method,data=None,auth=token,headers=None):
    try: request(path,method,data,auth,headers);raise AssertionError('Expected rejection')
    except urllib.error.HTTPError: pass
expect_rejection('/api/jobs','POST',{'width':1280})
expect_rejection('/api/jobs','POST',{},auth=None)
expect_rejection('/api/diagnostics','GET',headers={'Origin':'https://example.com'})
checks.append('Invalid settings, missing tokens and cross-origin access rejected')
def run(w,h,frames,audio=False):
    settings=dict(width=w,height=h,fps=24,frames=frames,crf=18,background='#112233',audioVolume=.5,audioStart=0)
    job=json.loads(request('/api/jobs','POST',settings,token))['id'];path='/api/jobs/'+job
    expect_rejection(path+'/frames/1','PUT',png(w,h,0))
    if audio:request(path+'/audio','PUT',tone(),token)
    for i in range(frames):request(path+'/frames/'+str(i),'PUT',png(w,h,i),token)
    request(path+'/encode','POST',b'',token)
    deadline=time.time()+60
    while time.time()<deadline:
        status=json.loads(request(path,token=token))
        if status['status']=='error':raise AssertionError(status)
        if status['status']=='done':break
        time.sleep(.1)
    else:raise AssertionError('Encode timeout')
    output=request(path+'/output',token=token)
    with tempfile.TemporaryDirectory() as folder:
        video=Path(folder)/'output.mp4';video.write_bytes(output)
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(video)]))
        stream=next(s for s in probe['streams'] if s['codec_type']=='video')
        assert(stream['width'],stream['height'])==(w,h)
        assert stream['codec_name']=='h264' and stream['pix_fmt']=='yuv420p'
        assert int(stream['nb_read_frames'])==frames
        assert abs(float(stream['duration'])-frames/24)<.002
        frame=subprocess.check_output(['ffmpeg','-v','error','-i',str(video),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])
        assert all(abs(frame[i]-target)<8 for i,target in enumerate([17,34,51])),frame[:3]
        if audio:assert any(s['codec_name']=='aac' for s in probe['streams'])
    request(path,'DELETE',token=token);expect_rejection(path,'GET')
    checks.append(f'{w}x{h}: H.264, yuv420p, {frames} frames, exact duration, alpha background, cleanup'+(' + AAC audio' if audio else ''))
run(1280,720,24,True)
run(2160,3840,2)
job=json.loads(request('/api/jobs','POST',dict(width=1280,height=720,fps=24,frames=1,crf=18,background='#112233'),token))['id']
request('/api/jobs/'+job,'DELETE',token=token);expect_rejection('/api/jobs/'+job,'GET')
checks.append('Cancelled capture job deleted')
job=json.loads(request('/api/jobs','POST',dict(width=2560,height=1440,fps=24,frames=48,crf=18,background='#112233'),token))['id']
frame=png(2560,1440,0)
for i in range(48):request('/api/jobs/'+job+'/frames/'+str(i),'PUT',frame,token)
request('/api/jobs/'+job+'/encode','POST',b'',token)
request('/api/jobs/'+job,'DELETE',token=token);expect_rejection('/api/jobs/'+job,'GET')
checks.append('Cancellation during native encoding stops the job and removes it')
for check in checks:print('PASS',check)
print(f'{len(checks)} integration groups passed.')
