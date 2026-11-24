const API = '';
const TOKEN_KEY = 'kundoluk_token';
const TYPE_KEY = 'kundoluk_type';

const state = {
  view: 'login',
  loginType: 'parent',
  token: null,
  userType: null,
  students: [],
  selectedStudentId: null,
  tab: 'home',
  loading: false,
  error: null,
  data: { timetable: null, grades: null, homework: null, notifications: null },
  gradesYear: new Date().getFullYear(),
  homeworkTerm: 1,
};

function getToken(){ return localStorage.getItem(TOKEN_KEY); }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function api(path, opts){
  opts = opts || {};
  const token = getToken();
  const headers = Object.assign({'Accept':'application/json'}, opts.headers||{});
  if (token) headers['Authorization'] = 'Bearer '+token;
  if (opts.body && !headers['Content-Type']) headers['Content-Type']='application/json';
  const res = await fetch(path, Object.assign({}, opts, {headers}));
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch(e){ data = text; }
  if (!res.ok) {
    const msg = (data && (data.resultMessage || data.message)) || (typeof data==='string'?data:'') || res.statusText || ('HTTP '+res.status);
    throw new Error(msg);
  }
  return data;
}
function p(path){ return '/api/p/' + String(path).replace(/^\/+/,''); }

async function login(type){
  const pin = (document.getElementById('pin')||{}).value || '';
  const password = (document.getElementById('password')||{}).value || '';
  if (!pin.trim()){ alert('Введите ПИН'); return; }
  state.loading = true; render();
  try {
    let body, url;
    if (type==='parent') {
      const fcm = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now()+'-'+Math.random());
      body = { userName: pin.trim(), password: password, fcm_token: fcm };
      url = '/api/login/parent';
    } else {
      body = { userName: pin.trim(), password: password };
      url = '/api/login/student';
    }
    const res = await api(url, { method:'POST', body: JSON.stringify(body) });
    const token = res && (res.actionResult && (res.actionResult.token || res.actionResult.Token)) || res.token || res.Token || res.accessToken;
    if (!token) throw new Error(res && res.resultMessage ? res.resultMessage : 'Токен не получен');
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TYPE_KEY, type);
    state.token = token;
    state.userType = type;
    state.view = 'app';
    await loadInitial();
  } catch(e){
    state.error = e.message;
    state.view = 'login';
  } finally {
    state.loading = false;
    render();
  }
}

async function loadInitial(){
  state.error = null;
  if (state.userType === 'parent') {
    try {
      const res = await api(p('parent/student/list'));
      state.students = (res && res.actionResult) || [];
      if (state.students.length) state.selectedStudentId = state.students[0].objectId;
    } catch(e){ state.error = e.message; state.students = []; }
  } else {
    state.students = [];
    state.selectedStudentId = null;
  }
  state.tab = 'home';
  state.data = { timetable: null, grades: null, homework: null, notifications: null };
  await loadTabData('home');
}

async function loadTabData(tab){
  state.loading = true; state.error = null; render();
  try {
    if (tab === 'home') {
      // nothing to fetch
    } else if (tab === 'timetable') {
      const route = state.userType === 'parent'
        ? `parent/raspisanie/list?idStudent=${encodeURIComponent(state.selectedStudentId||'')}`
        : `student/raspisanie/list`;
      const res = await api(p(route));
      state.data.timetable = (res && res.actionResult) || [];
    } else if (tab === 'grades') {
      const year = state.gradesYear;
      const route = state.userType === 'parent'
        ? `parent/qmarks/all?idStudent=${encodeURIComponent(state.selectedStudentId||'')}&YearParam=${year}`
        : `student/qmarks/all?YearParam=${year}`;
      const res = await api(p(route));
      state.data.grades = (res && res.actionResult) || [];
    } else if (tab === 'homework') {
      const term = state.homeworkTerm;
      const route = state.userType === 'parent'
        ? `parent/homework/list?term_no=${term}&idStudent=${encodeURIComponent(state.selectedStudentId||'')}`
        : `student/homework/list?term_no=${term}`;
      const res = await api(p(route));
      state.data.homework = (res && res.actionResult) || [];
    } else if (tab === 'notifications') {
      const route = state.userType === 'parent'
        ? `parent/notification/listAll`
        : `student/notification/listAll`;
      let res;
      try { res = await api(p(route)); }
      catch(e){ res = await api(p('notification/listAll')).catch(()=>null); }
      state.data.notifications = (res && res.actionResult) || (Array.isArray(res)?res:[]) || [];
    }
  } catch(e){
    state.error = e.message;
  } finally {
    state.loading = false;
    render();
  }
}

function logout(){
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TYPE_KEY);
  state.token = null;
  state.userType = null;
  state.view = 'login';
  state.students = [];
  state.selectedStudentId = null;
  state.data = { timetable: null, grades: null, homework: null, notifications: null };
  state.error = null;
  render();
}

function setLoginType(t){ state.loginType = t; render(); }
async function doLogin(){ await login(state.loginType); }
function switchTab(t){ state.tab = t; loadTabData(t); }
function selectStudent(id){ state.selectedStudentId = id; loadTabData(state.tab); }
function changeGradesYear(v){ state.gradesYear = +v; loadTabData('grades'); }
function changeHomeworkTerm(v){ state.homeworkTerm = +v; loadTabData('homework'); }

async function markRead(id){
  try {
    const route = state.userType === 'parent' ? 'parent/notification/markAsRead' : 'notification/markAsRead';
    await api(p(route), { method:'POST', body: JSON.stringify({objectId:id}) }).catch(()=>null);
    const n = (state.data.notifications||[]).find(x=>x.objectId===id);
    if (n) n.isRead = true;
    render();
  } catch(e){ console.error(e); }
}

function render(){ document.getElementById('app').innerHTML = state.view==='login' ? renderLogin() : renderApp(); }

function renderLogin(){
  return `
  <div class="screen login-wrap">
    <div class="logo">
      <div class="emoji">📚</div>
      <h1>Күндөлүк</h1>
      <p class="muted">Веб-версия для iPhone</p>
    </div>
    <div class="card">
      <div class="tabs" style="justify-content:center;margin-bottom:12px;">
        <button class="tab ${state.loginType==='parent'?'active':''}" onclick="setLoginType('parent')">Родитель</button>
        <button class="tab ${state.loginType==='student'?'active':''}" onclick="setLoginType('student')">Ученик</button>
      </div>
      ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}
      <div class="field">
        <label>ПИН (логин)</label>
        <input id="pin" class="input" type="text" inputmode="numeric" placeholder="Ваш ПИН" value="">
      </div>
      <div class="field">
        <label>Пароль</label>
        <input id="password" class="input" type="password" placeholder="Пароль">
      </div>
      <button class="btn btn-primary" onclick="doLogin()" ${state.loading?'disabled':''}>${state.loading?'Вход...':'Войти'}</button>
      <p class="muted" style="margin-top:12px;font-size:12px;">Данные передаются на сервер Күндөлүк через этот сайт. Пароль на сервере не сохраняется.</p>
    </div>
  </div>`;
}

function renderApp(){
  const s = (state.userType==='parent') ? (state.students||[]).find(x=>x.objectId===state.selectedStudentId) : null;
  const studentSelector = (state.userType === 'parent' && (state.students||[]).length)
    ? `<select class="select" onchange="selectStudent(this.value)">${state.students.map(st=>`<option value="${escapeHtml(st.objectId)}" ${st.objectId===state.selectedStudentId?'selected':''}>${escapeHtml((st.grade||'')+' класс '+(st.letter||''))} — ${escapeHtml(((st.firstName||'')+' '+(st.lastName||'')).trim()||'Ученик')}</option>`).join('')}</select>`
    : '';
  return `
  <div class="topbar">
    <div class="title">Күндөлүк</div>
    <button onclick="logout()">Выйти</button>
  </div>
  <div class="screen">
    ${studentSelector}
    ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}
    ${state.loading ? '<div class="spinner"></div>' : renderTabContent()}
  </div>
  ${renderBottomNav()}
  `;
}

function renderBottomNav(){
  const items = [
    {id:'home', icon:'🏠', label:'Главная'},
    {id:'timetable', icon:'📅', label:'Расписание'},
    {id:'grades', icon:'📊', label:'Оценки'},
    {id:'homework', icon:'📝', label:'ДЗ'},
    {id:'notifications', icon:'🔔', label:'Уведомления'},
  ];
  return `<div class="bottom-nav">${items.map(i=>`<button class="${state.tab===i.id?'active':''}" onclick="switchTab('${i.id}')"><span class="icon">${i.icon}</span>${i.label}</button>`).join('')}</div>`;
}

function renderTabContent(){
  switch(state.tab){
    case 'home': return renderHome();
    case 'timetable': return renderTimetable();
    case 'grades': return renderGrades();
    case 'homework': return renderHomework();
    case 'notifications': return renderNotifications();
    default: return '';
  }
}

function renderHome(){
  const s = (state.userType==='parent') ? (state.students||[]).find(x=>x.objectId===state.selectedStudentId) : null;
  let html = `<h1>Главная</h1>`;
  if (s) {
    html += `<div class="card">
      <h2>${escapeHtml(((s.firstName||'')+' '+(s.lastName||'')).trim()||'Ученик')}</h2>
      <p class="muted">${escapeHtml(s.grade||'')} класс ${escapeHtml(s.letter||'')} · ${escapeHtml((s.school&&s.school.name)||'')}</p>
    </div>`;
  } else if (state.userType==='student') {
    html += `<div class="card"><p>Вы вошли как ученик.</p></div>`;
  }
  const n = state.data.notifications;
  if (Array.isArray(n)) {
    const unread = n.filter(x=>!x.isRead).length;
    html += `<div class="card"><div class="between"><span>Непрочитанных уведомлений</span><span class="badge ${unread?'warn':'success'}">${unread}</span></div></div>`;
  }
  html += `<div class="card"><p class="muted">Используйте вкладки внизу для просмотра расписания, оценок, домашних заданий и уведомлений.</p></div>`;
  return html;
}

function renderTimetable(){
  const items = state.data.timetable || [];
  if (!items.length) return `<h1>Расписание</h1><div class="empty">Нет данных</div>`;
  let html = `<h1>Расписание уроков</h1><div class="card"><table class="table"><thead><tr><th>#</th><th>Предмет</th><th>Время</th><th>Учитель</th></tr></thead><tbody>`;
  items.forEach((it, idx) => {
    const subj = (it.subject && (it.subject.shortRu || it.subject.shortKg || it.subject.name)) || '';
    const teacher = (it.teacher && it.teacher.lastName) ? `${it.teacher.lastName} ${it.teacher.firstName||''}` : '';
    const time = it.startTime ? `${it.startTime}${it.endTime?'–'+it.endTime:''}` : '';
    html += `<tr><td>${escapeHtml(it.lesson!=null?it.lesson:idx+1)}</td><td>${escapeHtml(subj)}</td><td>${escapeHtml(time)}</td><td>${escapeHtml(teacher)}</td></tr>`;
  });
  html += `</tbody></table></div>`;
  return html;
}

function renderGrades(){
  const items = state.data.grades || [];
  const years = [2025,2026,2027];
  let html = `<h1>Оценки</h1>
  <select class="select" onchange="changeGradesYear(this.value)">${years.map(y=>`<option value="${y}" ${y===state.gradesYear?'selected':''}>${y} год</option>`).join('')}</select>`;
  if (!items.length) { html += `<div class="empty">Нет данных</div>`; return html; }
  items.forEach(it => {
    const name = it.subjectNameRu || it.subjectNameKg || (it.subject && it.subject.name) || 'Предмет';
    html += `<div class="card subject-card">
      <h3>${escapeHtml(name)}</h3>
      <div class="marks">
        ${(it.quarterMarks||[]).map(q=>`<span class="mark-chip">Q${escapeHtml(q.quarter)}: <b>${q.quarterMark!=null?q.quarterMark:(q.quarterAvg!=null?q.quarterAvg:'—')}</b></span>`).join('')}
        ${(it.yearMarks||[]).map(y=>`<span class="mark-chip">Год: <b>${y.yearMark!=null?y.yearMark:(y.yearAvg!=null?y.yearAvg:'—')}</b></span>`).join('')}
      </div>
    </div>`;
  });
  return html;
}

function renderHomework(){
  const items = state.data.homework || [];
  const terms = [1,2,3,4];
  let html = `<h1>Домашние задания</h1>
  <select class="select" onchange="changeHomeworkTerm(this.value)">${terms.map(t=>`<option value="${t}" ${t===state.homeworkTerm?'selected':''}>Четверть ${t}</option>`).join('')}</select>`;
  if (!items.length) { html += `<div class="empty">Нет данных</div>`; return html; }
  items.forEach(it => {
    const subj = (it.subject && (it.subject.shortRu || it.subject.shortKg || it.subject.name)) || '';
    const task = it.task || (it.lastTask && it.lastTask.name) || '';
    const date = it.lessonDay ? String(it.lessonDay).slice(0,10) : '';
    const teacher = (it.teacher && it.teacher.lastName) ? `${it.teacher.lastName} ${it.teacher.firstName||''}` : '';
    html += `<div class="hw-item">
      <div class="hw-date">${escapeHtml(date)} ${escapeHtml(it.startTime||'')} · ${escapeHtml(teacher)}</div>
      <div class="hw-subject">${escapeHtml(subj)}</div>
      <div class="hw-task">${escapeHtml(task || '—')}</div>
    </div>`;
  });
  return html;
}

function renderNotifications(){
  const items = state.data.notifications || [];
  if (!items.length) return `<h1>Уведомления</h1><div class="empty">Нет данных</div>`;
  let html = `<h1>Уведомления</h1>`;
  items.forEach(it => {
    const date = it.creationDate || it.endDate || '';
    html += `<div class="notif-item ${it.isRead?'':'unread'}">
      <div class="notif-title">${escapeHtml(it.titleRu||it.title||'')}</div>
      <div class="notif-msg">${escapeHtml(it.messageRu||it.message||'')}</div>
      <div class="notif-date">${escapeHtml(String(date).slice(0,16))}</div>
      ${!it.isRead ? `<button class="btn btn-small btn-secondary" style="margin-top:6px;" onclick="markRead('${escapeHtml(it.objectId)}')">Прочитано</button>` : ''}
    </div>`;
  });
  return html;
}

(async function init(){
  const token = getToken();
  if (token) {
    state.token = token;
    state.userType = localStorage.getItem(TYPE_KEY);
    state.view = 'app';
    try { await loadInitial(); }
    catch(e){ logout(); }
  }
  render();
})();
