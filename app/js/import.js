
/**
 * FundedControl — Import Module (v3.0.0 Phase 2)
 * Excel/CSV import logic
 */

async function importExcel(){
    const file=document.getElementById('import-file').files[0];
    if(!file){toast('Select a file first','warning');return;}
    const reader=new FileReader();
    reader.onload=async e=>{
        try {
            const wb = XLSX.read(e.target.result, {type:'binary', cellDates:false, raw:true});
            const sheetName = wb.SheetNames.find(n=>n.includes('Trade'))||wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
            let headerRowIdx = -1, headerMap = {};
            for(let i=0; i<rows.length; i++){
                const row = rows[i];
                if(row.some(c=>String(c).trim()==='Date') && row.some(c=>String(c).trim()==='Pair')){
                    headerRowIdx = i;
                    row.forEach((cell,idx)=>{ if(cell) headerMap[String(cell).trim()] = idx; });
                    break;
                }
            }
            if(headerRowIdx===-1){toast('Cannot find header row with Date and Pair columns','error');return;}
            const get = (row, name) => { const idx = headerMap[name]; return idx !== undefined ? row[idx] : ''; };
            const parseDate = (val) => {
                if(!val && val!==0) return '';
                const s = String(val).trim();
                if(!s) return '';
                const num = parseFloat(s);
                if(!isNaN(num) && num > 40000 && num < 60000) { const d = new Date(Math.round((num - 25569) * 86400 * 1000)); return d.toISOString().split('T')[0]; }
                if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) { const [dd,mm,yyyy] = s.split('/'); return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`; }
                if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
                const d = new Date(s); if(!isNaN(d)) return d.toISOString().split('T')[0]; return '';
            };
            const trades = [];
            for(let i = headerRowIdx+1; i < rows.length; i++){
                const row = rows[i];
                const pair = String(get(row,'Pair')||'').trim();
                const dateRaw = get(row,'Date');
                if(!pair || !dateRaw) continue;
                const trade_date = parseDate(dateRaw);
                if(!trade_date) continue;
                trades.push({ trade_date, session:String(get(row,'Session')||'London'), pair, direction:String(get(row,'Direction')||'Long'), entry_price:get(row,'Entry')||'', stop_loss:get(row,'Stop Loss')||'', take_profit:get(row,'Take Profit')||'', exit_price:get(row,'Exit Price')||'', lot_size:get(row,'Lot Size')||'', pnl:get(row,'P&L $')||0, fees:get(row,'Fees $')||0, r_multiple:get(row,'R Multiple')||0, result:String(get(row,'Result')||''), confidence:String(get(row,'Confidence')||''), exec_score:get(row,'Exec Score')||'', fib_level:String(get(row,'Fib Level')||''), fsa_rules:String(get(row,'FSA Rules')||''), notes:String(get(row,'Notes')||'') });
            }
            if(!trades.length){toast('No valid trades found','error');return;}
            const r = await api('import_trades','POST',{trades});
            toast(`Imported ${r.imported} trades! ✅`);
            document.getElementById('import-modal').classList.remove('open');
            loadTrades(); loadDashboard();
        } catch(err){ toast('Error: '+err.message,'error'); console.error(err); }
    };
    reader.readAsBinaryString(file);
}
