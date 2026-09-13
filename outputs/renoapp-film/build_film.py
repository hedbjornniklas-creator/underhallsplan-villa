from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
W, H, FPS = 1280, 720, 24
BG = '#ffffff'
INK = '#192923'
GREEN = '#00654e'
MUTED = '#52605a'
FONT = Path('C:/Windows/Fonts')

def font(size, bold=False):
    return ImageFont.truetype(str(FONT / ('segoeuib.ttf' if bold else 'segoeui.ttf')), size)

def label(im, xy, text, size=26, fill=INK, bold=False):
    ImageDraw.Draw(im).text(xy, text, font=font(size, bold), fill=fill, spacing=8)

logo = Image.open(ROOT / 'public/landing/Renoapp.png').convert('RGB')
board = Image.open(ROOT / 'tmp/renoapp-completion-ui/board-1440.png').convert('RGB')
mobile = Image.open(ROOT / 'tmp/renoapp-resident-journey/344-06-renovation.png').convert('RGB')

def paste_scaled(im, source, box):
    x,y,w,h = box
    source = source.copy()
    source.thumbnail((w,h), Image.Resampling.LANCZOS)
    im.paste(source,(x+(w-source.width)//2,y+(h-source.height)//2))

def base():
    im = Image.new('RGB',(W,H),BG)
    paste_scaled(im,logo,(52,28,172,63))
    ImageDraw.Draw(im).rectangle((0,704,W,720),fill=GREEN)
    label(im,(1090,47),'hushub.se',20,fill=MUTED)
    return im

scenes=[]
im=base()
label(im,(64,186),'Renoverings\u00e4renden.\nEnklare f\u00f6r alla.',55,bold=True)
label(im,(66,357),'Smidigt f\u00f6r de boende.\nSamlat f\u00f6r styrelsen.',30,fill=MUTED)
label(im,(66,592),'RenoApp f\u00f6r er f\u00f6rening',23,fill=GREEN,bold=True)
# Show the actual mobile form, cropped to the renovation questions.
d=ImageDraw.Draw(im)
d.rounded_rectangle((869,111,1151,671),radius=30,fill=INK)
paste_scaled(im,mobile.crop((0,324,344,1030)),(879,128,262,526))
scenes.append(im)

im=base()
label(im,(64,116),'St\u00f6d att beg\u00e4ra r\u00e4tt underlag',44,bold=True)
label(im,(66,185),'F\u00f6rslag utifr\u00e5n vad den boende vill renovera.',26,fill=MUTED)
paste_scaled(im,board.crop((240,184,1201,478)),(60,277,1160,355))
scenes.append(im)

im=base()
label(im,(64,116),'Allt samlat. B\u00e4ttre \u00f6verblick.',44,bold=True)
label(im,(66,185),'Handlingar och f\u00f6retagsuppgifter i samma \u00e4rende.',26,fill=MUTED)
paste_scaled(im,board.crop((240,184,1201,366)),(74,246,1132,214))
paste_scaled(im,board.crop((240,659,1201,950)),(74,462,1132,211))
scenes.append(im)

im=Image.new('RGB',(W,H),BG)
paste_scaled(im,logo,(360,117,560,205))
label(im,(235,361),'Enklare f\u00f6r de boende.',43,bold=True)
label(im,(235,420),'B\u00e4ttre st\u00f6d f\u00f6r styrelsen.',43,bold=True)
label(im,(532,560),'hushub.se',36,fill=GREEN,bold=True)
ImageDraw.Draw(im).rectangle((0,704,W,720),fill=GREEN)
scenes.append(im)

for i,im in enumerate(scenes):
    im.save(OUT / f'scene-{i+1}.png')

durations=[5,5,4.5,3.5]
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
output=OUT / 'RenoApp-kort-presentation.mp4'
cmd=[ffmpeg,'-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(output)]
proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=subprocess.PIPE)
fade=10
for index,(scene,seconds) in enumerate(zip(scenes,durations)):
    for frame in range(int(seconds*FPS)):
        current=scene
        if index and frame<fade:
            alpha=(frame+1)/fade
            alpha=alpha*alpha*(3-2*alpha)
            current=Image.blend(scenes[index-1],scene,alpha)
        proc.stdin.write(current.tobytes())
proc.stdin.close()
log=proc.stderr.read().decode('utf-8',errors='replace')
if proc.wait()!=0:
    raise RuntimeError(log)
# Decode the entire export to verify that it is readable.
verify=subprocess.run([ffmpeg,'-v','error','-i',str(output),'-f','null','-'],capture_output=True,text=True)
if verify.returncode or verify.stderr.strip():
    raise RuntimeError(verify.stderr)
sheet=Image.new('RGB',(1280,720),'#ddd')
for i,scene in enumerate(scenes):
    sheet.paste(scene.resize((640,360),Image.Resampling.LANCZOS),((i%2)*640,(i//2)*360))
sheet.save(OUT/'overview.jpg',quality=92)
print(f'Created {output}; 18 seconds; {W}x{H}; {FPS} fps; {output.stat().st_size} bytes; full decode OK')
