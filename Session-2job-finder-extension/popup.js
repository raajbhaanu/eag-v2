const API_KEY = 'xx'; 
const MODEL_NAME = 'gemini-2.5-flash'; 

let jobs = [], managers = [], view = 'jobs', page = 1;
const SIZE = 10;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('searchBtn').onclick = startSearch;
    document.getElementById('showJobs').onclick = () => { view = 'jobs'; page = 1; render(); };
    document.getElementById('showManagers').onclick = () => { view = 'managers'; page = 1; render(); };
    document.getElementById('prevBtn').onclick = () => { if (page > 1) { page--; render(); } };
    document.getElementById('nextBtn').onclick = () => { if (page * SIZE < currentList().length) { page++; render(); } };
});

async function startSearch() {
    const industry = document.getElementById('industryInput').value;
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('results').classList.add('hidden');

    const prompt = `Return ONLY a JSON object: {"jobs": [{"title": "Job Title", "url": "url"}], "managers": [{"name": "Name", "url": "url"}]}. Provide 30 entries for each. Nashville graduate in: ${industry}`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        
        const raw = data.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
        const json = JSON.parse(raw);
        jobs = json.jobs || [];
        managers = json.managers || [];
        page = 1; render();
        
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('results').classList.remove('hidden');
    } catch (e) {
        alert("API Error: " + e.message);
        document.getElementById('loading').classList.add('hidden');
    }
}

function currentList() { return view === 'jobs' ? jobs : managers; }

function render() {
    const list = document.getElementById('displayList');
    list.innerHTML = '';
    
    document.getElementById('showJobs').className = view === 'jobs' ? 'active' : '';
    document.getElementById('showManagers').className = view === 'managers' ? 'active' : '';

    const data = currentList();
    data.slice((page - 1) * SIZE, page * SIZE).forEach(item => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="${item.url}" target="_blank">${item.title || item.name}</a>`;
        list.appendChild(li);
    });

    document.getElementById('pageTxt').innerText = `Page ${page}`;
    document.getElementById('prevBtn').disabled = (page === 1);
    document.getElementById('nextBtn').disabled = (page * SIZE >= data.length);
}