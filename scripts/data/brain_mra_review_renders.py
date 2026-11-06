"""Review renders of the Lausanne aneurysm masks (selection of brain-mra): for every mask, the axial slice through its centre,
20 mm axial and coronal MIPs and a whole-head axial MIP, outline in red (RAS canonical, image right = patient right).

  C:/Users/kerim/radiology-data/venv-gpu/Scripts/python.exe scripts/data/brain_mra_review_renders.py
  -> C:/Users/kerim/radiology-data/work/brain-mra/review/<sub>_<lesion>.png
"""
import nibabel as nib, numpy as np, glob, os, sys
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from scipy import ndimage as ndi
from skimage import measure
R='C:/Users/kerim/radiology-data/raw/Lausanne-TOF'; OUT='C:/Users/kerim/radiology-data/work/brain-mra/review'
def ras_canon(img):
    return nib.as_closest_canonical(img)
for f in sorted(glob.glob(R+'/angio/*_angio.nii.gz')):
    sub,ses=os.path.basename(f).split('_')[:2]
    im=ras_canon(nib.load(f)); a=np.asarray(im.dataobj).astype(np.float32); z=im.header.get_zooms()
    ms=sorted(glob.glob(f'{R}/masks/{sub}_{ses}_desc-Lesion_*_mask.nii.gz'))
    for m in ms:
        mk=np.asarray(ras_canon(nib.load(m)).dataobj)>0
        c=np.round(ndi.center_of_mass(mk)).astype(int)
        lab=os.path.basename(m).split('desc-')[1].split('_mask')[0]
        hw=int(round(25/z[0]))  # 50 mm window
        sl=lambda ax: slice(max(0,c[ax]-hw), c[ax]+hw)
        fig,axs=plt.subplots(1,4,figsize=(16,4.4))
        vmax=np.percentile(a,99.95)
        # axial slice (RAS canonical: i=x (R->L? canonical RAS: i increases to Right?), show with origin lower)
        ax_img=a[:,:,c[2]].T; ax_m=mk[:,:,c[2]].T
        slab=int(round(10/z[2]))
        mip_ax=a[:,:,max(0,c[2]-slab):c[2]+slab].max(2).T; m_ax=mk[:,:,max(0,c[2]-slab):c[2]+slab].max(2).T
        mip_co=a[:,max(0,c[1]-slab):c[1]+slab,:].max(1).T; m_co=mk[:,max(0,c[1]-slab):c[1]+slab,:].max(1).T
        mip_full=a.max(2).T; 
        for axx,img,mm,title,asp in [(axs[0],ax_img,ax_m,f'axial slice k={c[2]}',z[1]/z[0]),(axs[1],mip_ax,m_ax,'axial MIP 20 mm',z[1]/z[0]),(axs[2],mip_co,m_co,'coronal MIP 20 mm',z[2]/z[0]),(axs[3],mip_full,mk.max(2).T,'axial MIP whole',z[1]/z[0])]:
            axx.imshow(img[::-1,::-1] if False else img,cmap='gray',vmin=0,vmax=vmax,origin='lower',aspect=asp)
            for cc in measure.find_contours(mm.astype(float),0.5): axx.plot(cc[:,1],cc[:,0],'r-',lw=0.8)
            axx.set_title(title,fontsize=9); axx.axis('off')
        for axx in axs[:3]:
            axx.set_xlim(c[0]-hw*2,c[0]+hw*2)
        axs[0].set_ylim(c[1]-hw*2,c[1]+hw*2); axs[1].set_ylim(c[1]-hw*2,c[1]+hw*2); axs[2].set_ylim(c[2]-hw*1.4,c[2]+hw*1.4)
        vol=mk.sum()*np.prod(z); 
        fig.suptitle(f'{sub} {lab}: {vol:.0f} mm3, image left = patient right (RAS canonical, x flipped?)',fontsize=10)
        fig.savefig(f'{OUT}/{sub}_{lab}.png',dpi=90,bbox_inches='tight'); plt.close(fig)
        print(sub,lab,c,round(float(vol),1))
