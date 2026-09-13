from pathlib import Path
import shutil
import subprocess
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

OUT = Path(__file__).resolve().parent / 'whiteboard'
OUT.mkdir(exist_ok=True)
SOURCE = Path('C:/Users/hedbj/.codex/generated_images/01a07ab6-a0ed-77c1-a6e6-4ee36a7f1209/exec-4ae9a01d-10f7-401f-99fd-31b398a24d83.png')
shutil.copy2(SOURCE, OUT / 'bildmanus.png')
source = Image.open(SOURCE).convert('RGB')
W, H, FPS = 1280, 720, 24
# Film framing coordinates in the approved 1672 x 941 storyboard.
boxes = [(206,149,561,493),(663,153,1004,494),(1102,153,1455,497),
         (210,543,563,876),(660,545,1006,881),(1100,542,1458,880)]
sx, sy = source.width/1672, source.height/941
notes = [source.crop(tuple(round(v*(sx if j%2==0 else sy)) for j,v in enumerate(box))) for box in boxes]
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',23)
background = Image.new('RGB',(W,H),'#f5f7f7')
d = ImageDraw.Draw(background)
d.rounded_rectangle((14,14,W-15,H-15),radius=15,outline='#9da7aa',width=5)
d.line((26,H-31,W-27,H-31),fill='#c2c9cb',width=2)
d.text((50,36),'RenoApp',font=font,fill='#293e3a')
d.text((1110,36),'hushub.se',font=font,fill='#293e3a')

def ease(t):
    t=max(0,min(1,t))
    return 1-(1-t)**3

def frame_for(index,t,duration):
    frame=background.copy()
    # Each note slides onto the board, settles, then holds for reading.
    entry=ease(t/0.48)
    drift=min(t/duration,1)
    height=round(540+8*drift)
    original=notes[index]
    scale=min(590/original.width,height/original.height)
    note=original.resize((round(original.width*scale),round(original.height*scale)),Image.Resampling.LANCZOS)
    x=round((W-note.width)/2+(1-entry)*760)
    y=round((H-note.height)/2+12)
    frame.paste(note,(x,y))
    return frame

durations=[4,3,3,2,5,3]
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
output=OUT/'RenoApp-whiteboard-20sek.mp4'
cmd=[ffmpeg,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(output)]
with (OUT/'encode.log').open('w') as log:
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
    for index,duration in enumerate(durations):
        for n in range(duration*FPS):
            frame=frame_for(index,n/FPS,duration)
            proc.stdin.write(frame.tobytes())
        frame_for(index,1,duration).save(OUT/f'scen-{index+1}.png')
    proc.stdin.close()
    if proc.wait()!=0:
        raise RuntimeError('Video encoding failed; see encode.log')
verification=subprocess.run([ffmpeg,'-v','error','-i',str(output),'-f','null','-'],capture_output=True,text=True)
assert verification.returncode==0 and not verification.stderr.strip(),verification.stderr
sheet=Image.new('RGB',(1280,1080),'white')
for i,duration in enumerate(durations):
    sheet.paste(frame_for(i,1,duration).resize((640,360)),((i%2)*640,(i//2)*360))
sheet.save(OUT/'oversikt.jpg',quality=94)
print(f'{output}: 20 seconds, 1280x720, 24 fps, {output.stat().st_size} bytes. Full video decode OK.',flush=True)
