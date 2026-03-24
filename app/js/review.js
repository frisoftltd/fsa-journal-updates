
/**
 * FundedControl — Review Module (v3.0.0 Phase 2)
 * Weekly review CRUD
 */

async function loadReviews(){
    allReviews=await api('get_reviews');
    const c=document.getElementById('reviews-list');
    if(!allReviews.length){c.innerHTML='<div class="empty"><div class="empty-icon">📝</div><p>No reviews yet.</p></div>';return;}
    c.innerHTML=allReviews.map(r=>`<div class="review-card">
        <div class="review-header"><span class="review-week">${r.week_start} → ${r.week_end}</span>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                <span style="font-size:11px;color:var(--text3)">Process <span style="color:var(--gold)">${r.process_score}/10</span></span>
                <span style="font-size:11px;color:var(--text3)">Mindset <span style="color:var(--purple)">${r.mindset_score}/10</span></span>
                <button class="btn btn-ghost btn-sm" onclick="editReview(${r.id})">Edit</button>
            </div>
        </div>
        ${r.key_lesson?`<div style="font-size:12px;color:var(--text2);margin-bottom:8px"><span style="color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:1px">Key Lesson: </span>${r.key_lesson}</div>`:''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${r.what_went_well?`<div style="font-size:12px"><div style="color:var(--green);font-size:10px;text-transform:uppercase;margin-bottom:3px">✅ Went Well</div>${r.what_went_well}</div>`:''}
            ${r.what_to_improve?`<div style="font-size:12px"><div style="color:var(--orange);font-size:10px;text-transform:uppercase;margin-bottom:3px">📈 Improve</div>${r.what_to_improve}</div>`:''}
        </div>
    </div>`).join('');
}

function openReviewModal(data=null){
    document.getElementById('review-form').reset();
    document.getElementById('review-id').value=data?.id||'';
    if(data){
        ['week_start','week_end','process_score','mindset_score','key_lesson','what_went_well','what_to_improve','rules_followed'].forEach(k=>{
            const el=document.getElementById('r-'+k); if(el&&data[k]) el.value=data[k];
        });
    } else {
        const now=new Date();
        const mon=new Date(now); mon.setDate(now.getDate()-now.getDay()+1);
        const sun=new Date(mon); sun.setDate(mon.getDate()+6);
        document.getElementById('r-week_start').value=mon.toISOString().split('T')[0];
        document.getElementById('r-week_end').value=sun.toISOString().split('T')[0];
    }
    document.getElementById('review-modal').classList.add('open');
}

async function editReview(id){ const r=allReviews.find(r=>r.id==id); if(r) openReviewModal(r); }

async function saveReview(){
    const id=document.getElementById('review-id').value;
    const data={id:id||null};
    ['week_start','week_end','process_score','mindset_score','key_lesson','what_went_well','what_to_improve','rules_followed'].forEach(k=>{ data[k]=document.getElementById('r-'+k)?.value||null; });
    await api('save_review','POST',data);
    toast('Review saved!');
    document.getElementById('review-modal').classList.remove('open');
    loadReviews();
}
