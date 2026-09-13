from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent/'combined'
OUT.mkdir(exist_ok=True)
W,H,FPS=1280,720,24
source=Image.open(OUT.parent/'whiteboard/bildmanus.png').convert('RGB')
boxes=[(206,149,561,493),(663,153,1004,494),(1102,153,1455,497),(210,543,563,876),(660,545,1006,881),(1100,542,1458,880)]
notes=[source.crop(tuple(round(v*(source.width/1672 if j%2==0 else source.height/941)) for j,v in enumerate(b))) for b in boxes]
mobile=Image.open(ROOT/'tmp/renoapp-resident-journey/344-06-renovation.png').convert('RGB')
board=Image.open(ROOT/'tmp/renoapp-completion-ui/board-1440.png').convert('RGB')
cases=Image.open(OUT/'cases.png').convert('RGB')
logo=Image.open(ROOT/'public/landing/Renoapp.png').convert('RGB')
def font(n,bold=False):
 return ImageFont.truetype('C:/Windows/Fonts/'+('segoeuib.ttf' if bold else 'segoeui.ttf'),n)
def ease(t):
 t=max(0,min(1,t));return t*t*(3-2*t)
def paste(im,asset,x,y,width,height):
 scale=min(width/asset.width,height/asset.height)
 sized=asset.resize((round(asset.width*scale),round(asset.height*scale)),Image.Resampling.LANCZOS)
 im.paste(sized,(round(x+(width-sized.width)/2),round(y+(height-sized.height)/2)))
def base():
 im=Image.new('RGB',(W,H),'#f5f7f7');d=ImageDraw.Draw(im)
 d.rounded_rectangle((14,14,W-15,H-15),radius=15,outline='#9da7aa',width=5)
 d.text((48,34),'RenoApp',font=font(23),fill='#293e3a')
 d.text((1110,34),'hushub.se',font=font(23),fill='#293e3a')
 return im
def heading(im,text):
 d=ImageDraw.Draw(im);f=font(38,True);width=d.textlength(text,font=f)
 d.text(((W-width)/2,91),text,font=f,fill='#193b33')
def frame(i,t):
 im=base()
 if i in (0,4,5):
  entry=ease(t/.45)
  paste(im,notes[{0:0,4:4,5:5}[i]],360+(1-entry)*850,105,560,540)
 elif i==1:
  heading(im,'Enkelt f\u00f6r den boende.')
  p=ease(t/.7)
  paste(im,notes[2],350-255*p,215,380,380)
  x=round(1280-515*p)
  ImageDraw.Draw(im).rounded_rectangle((x-10,159,x+283,680),radius=23,fill='#263e37')
  # Gentle real-page scroll, stopping before the long project-description field.
  top=round(325+85*ease((t-1)/3))
  paste(im,mobile.crop((0,top,344,top+630)),x,170,273,500)
 elif i==2:
  heading(im,'Allt samlat f\u00f6r styrelsen.')
  p=ease(t/.65)
  paste(im,notes[3],350-300*p,245,300,300)
  x=round(1280-897*p)
  paste(im,board.crop((240,184,1200,367)),x,192,828,205)
  paste(im,board.crop((240,659,1200,950)),x,402,828,248)
 elif i==3:
  heading(im,'\u00d6verblick utan kr\u00e5ngel.')
  p=ease(t/.5)
  paste(im,cases.crop((95,90,1185,550)),65+(1-p)*1250,167,1150,482)
 return im

durations=[4,6,7,5,5,3]
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
output=OUT/'RenoApp-whiteboard-och-app-30sek.mp4'
cmd=[ffmpeg,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(output)]
with (OUT/'encode.log').open('w') as log:
 proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
 for i,duration in enumerate(durations):
  for n in range(duration*FPS):
   current=frame(i,n/FPS)
   if i and n<8:
    current=Image.blend(frame(i-1,durations[i-1]-.01),current,ease(n/8))
   proc.stdin.write(current.tobytes())
  frame(i,2).save(OUT/f'scene-{i+1}.png')
 proc.stdin.close()
 assert proc.wait()==0,'Encoding failed'
result=subprocess.run([ffmpeg,'-v','error','-i',str(output),'-f','null','-'],capture_output=True,text=True)
assert result.returncode==0 and not result.stderr.strip(),result.stderr
sheet=Image.new('RGB',(1280,1080),'white')
for i in range(6):sheet.paste(frame(i,2).resize((640,360)),((i%2)*640,(i//2)*360))
sheet.save(OUT/'overview.jpg',quality=95)
print(f'{output}: 30 seconds, 1280x720, 24fps. Entire file decoded successfully.',flush=True)
