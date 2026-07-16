/* ===================================================================
   app.js — 스터디 드래곤 메인 로직
   =================================================================== */

import {
  isConfigured, addCheer, fetchCheersForMonth,
  reportProgress, fetchDayStats,
} from "./firebase.js";
import { clean } from "./badwords.js";

/* ===================================================================
   설정 — 여기만 고치면 됩니다
   =================================================================== */

// 선생님 지정 과제 3개 (PRD 기능 ①)
const TEACHER_TASKS = [
  "독서 30분",
  "수학 문제 10개",
  "영어 단어 10개",
];

// 완료 칸 수에 따른 테마 색 (PRD 기능 ①)
const THEME_COLORS = [
  "#94A3B8", // 0칸 — 회색
  "#3B82F6", // 1칸 — 파랑
  "#22C55E", // 2칸 — 초록
  "#F97316", // 3칸 — 주황
  "#F43F5E", // 4칸 — 핑크/빨강
];

/**
 * 5단계 드래곤 (PRD 기능 ②) — min은 "이번 달" 하트 기준
 *
 * 매월 1일에 알로 돌아가므로 기준도 한 달 크기에 맞춰야 합니다.
 * 한 달 최대는 약 120하트(30일 × 4칸)입니다.
 *
 *   하루 평균 1칸 (월 30)  -> Lv.3 날쌘 아기용
 *   하루 평균 2칸 (월 60)  -> Lv.4 용맹한 드래곤
 *   하루 평균 2.5칸 (월 75) -> Lv.5 마스터 드래곤
 *
 * 예전엔 Lv.5가 100이었는데, 그건 평생 누적이라 가능했던 숫자입니다.
 * 월간으로 바꾸면 25일을 완벽하게 채워야 해서 아무도 마스터를 못 봅니다.
 * PRD 화면 1의 예시 "Lv.3, ❤️32"는 이 기준에서도 그대로 Lv.3입니다.
 */
const DRAGONS = [
  { min: 0,  emoji: "🥚", name: "신비한 알",     bubble: "따뜻하게 품어주기" },
  { min: 10, emoji: "🐣", name: "꼬마 해치",     bubble: "알을 깨고 나왔어!" },
  { min: 25, emoji: "🦎", name: "날쌘 아기용",   bubble: "날개가 돋아났어!" },
  { min: 45, emoji: "🐲", name: "용맹한 드래곤", bubble: "비늘이 단단해졌어!" },
  { min: 70, emoji: "🐉", name: "마스터 드래곤", bubble: "전설의 마스터다!" },
];

const STORE_KEY = "studyDragon";
const DEVICE_KEY = "studyDragonDevice";
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/* ===================================================================
   유틸
   =================================================================== */

const $ = (id) => document.getElementById(id);

/**
 * Date → "2026-07-15"
 * ※ toISOString()을 쓰면 안 됩니다! 그건 UTC 기준이라
 *   한국(UTC+9)에서 새벽 0~9시에 날짜가 하루 밀립니다.
 */
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const todayKey = () => dateKey(new Date());

/**
 * 이 기기의 익명 ID
 *
 * 교사용 통계에서 "학생 몇 명"을 세려면 기기를 구분할 무언가가 필요합니다.
 * 이름이나 별명 대신 그냥 난수를 씁니다. 사람과 연결되는 정보가 아니라
 * 데이터를 전부 내려받아도 누구인지 알아낼 수 없습니다.
 * (PRD 2장 "복잡한 개인정보나 별명 연동 없이"를 지키기 위한 방식입니다.)
 */
function deviceId() {
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch {}
  if (!id) {
    id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now());
    try { localStorage.setItem(DEVICE_KEY, id); } catch {}
  }
  return id;
}

/* ===================================================================
   저장 — localStorage (내 기기 전용)
   =================================================================== */

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    return {
      missions: raw?.missions ?? {},
      diaries: raw?.diaries ?? {},
    };
  } catch {
    // 저장된 값이 깨졌어도 앱이 죽지 않도록
    return { missions: {}, diaries: {} };
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn("저장 실패:", e);
  }
}

/** 그 날짜의 미션 데이터를 꺼냄 (없으면 빈 것을 만들어 줌) */
function getMission(key) {
  if (!store.missions[key]) {
    store.missions[key] = {
      tasks: [false, false, false],
      custom: { text: "", done: false },
    };
  }
  return store.missions[key];
}

/**
 * 그 날 완료한 칸 수 (0~4)
 * ※ ?. 를 붙인 이유: 예전에 저장된 데이터의 모양이 조금 달라도
 *   앱이 흰 화면으로 죽지 않고 그냥 0으로 처리하게 하려고요.
 */
function countDone(key) {
  const m = store.missions[key];
  if (!m) return 0;
  const t = (m.tasks ?? []).filter(Boolean).length;
  const c = m.custom?.done && m.custom?.text?.trim() ? 1 : 0;
  return t + c;
}

/** Date → "2026-07" */
const monthOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const thisMonth = () => monthOf(new Date());

/**
 * 이번 달 하트 = 이번 달 날짜들의 완료 칸 수 합계
 *
 * ★ 매월 1일에 드래곤이 알로 돌아가는 방식 ★
 *   지난 기록을 지우지 않습니다. 세는 범위만 이번 달로 좁힐 뿐입니다.
 *   그래서 1일이 되면 이번 달 하트가 자연스럽게 0이 되고, 캘린더의
 *   지난 달 하트와 7일 그래프는 그대로 남습니다. 지울 게 없으니
 *   리셋이 실패하거나 데이터가 날아갈 일도 없습니다.
 *
 * ※ 따로 저장하지 않고 매번 셉니다. 두 값이 어긋날 일이 없어서 안전합니다.
 */
function monthHearts(mk = thisMonth()) {
  return Object.keys(store.missions)
    .filter((k) => k.startsWith(mk + "-"))     // "2026-07-15".startsWith("2026-07-")
    .reduce((sum, k) => sum + countDone(k), 0);
}

/* ===================================================================
   상태
   =================================================================== */

let store = load();
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth() + 1;   // 1~12
let openKey = null;                          // 지금 열린 미션 모달의 날짜
let cheers = {};                             // { "2026-07-15": ["메시지", ...] }

/* ===================================================================
   테마 색
   =================================================================== */

function applyTheme(done) {
  const color = THEME_COLORS[Math.min(done, 4)];
  const root = document.documentElement.style;
  root.setProperty("--theme", color);
  root.setProperty("--theme-soft", color + "15");   // 뒤 15 = 아주 옅은 투명도
}

/** 모달이 닫혀 있을 때의 기본 테마 = 오늘 진도 */
function resetTheme() {
  applyTheme(countDone(todayKey()));
}

/* ===================================================================
   화면 1 — 캘린더
   =================================================================== */

function renderCalendar() {
  $("monthTitle").textContent = `${viewYear}년 ${viewMonth}월`;

  const grid = $("calendar");
  grid.innerHTML = "";

  // 1일이 무슨 요일인지 → 앞쪽 빈칸 개수
  const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay();
  // 그 달의 마지막 날 (month를 그대로 주고 day=0 → 전달 마지막 날)
  const lastDate = new Date(viewYear, viewMonth, 0).getDate();

  for (let i = 0; i < firstDow; i++) {
    const blank = document.createElement("div");
    blank.className = "day empty";
    grid.appendChild(blank);
  }

  const tKey = todayKey();

  for (let d = 1; d <= lastDate; d++) {
    const key = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = new Date(viewYear, viewMonth - 1, d).getDay();
    const done = countDone(key);

    const cell = document.createElement("button");
    cell.className = "day";
    if (dow === 0) cell.classList.add("sun");
    if (dow === 6) cell.classList.add("sat");
    if (key === tKey) cell.classList.add("today");
    if (key > tKey) cell.classList.add("future");   // 문자열 비교로 미래 판별 (YYYY-MM-DD라 가능)

    const num = document.createElement("span");
    num.className = "day-num";
    num.textContent = d;
    cell.appendChild(num);

    // 완료 개수만큼 하트 — 4칸이면 별 하나 (PRD 기능 ①)
    const marks = document.createElement("span");
    marks.className = "day-marks";
    if (done === 4) {
      marks.classList.add("perfect");
      marks.textContent = "⭐";
    } else if (done > 0) {
      marks.textContent = "❤️".repeat(done);
    }
    cell.appendChild(marks);

    // 응원이 있는 날 핑크 뱃지
    if (cheers[key]?.length) {
      const badge = document.createElement("span");
      badge.className = "day-badge";
      cell.appendChild(badge);
    }

    cell.addEventListener("click", () => openMission(key));
    grid.appendChild(cell);
  }
}

/* ===================================================================
   화면 1 하단 — 캐릭터 카드 (드래곤 진화)
   =================================================================== */

function dragonOf(hearts) {
  // 뒤에서부터 찾으면 조건에 맞는 가장 높은 레벨이 걸립니다
  for (let i = DRAGONS.length - 1; i >= 0; i--) {
    if (hearts >= DRAGONS[i].min) return { ...DRAGONS[i], level: i + 1 };
  }
  return { ...DRAGONS[0], level: 1 };
}

function renderCharacter() {
  const hearts = monthHearts();
  const dragon = dragonOf(hearts);
  const next = DRAGONS[dragon.level];   // 다음 단계 (없으면 undefined = 최고 레벨)

  $("charEmoji").textContent = dragon.emoji;
  $("charBubble").textContent = dragon.bubble;
  $("charLevel").textContent = `Lv.${dragon.level}`;
  $("charName").textContent = dragon.name;
  $("charHearts").textContent = hearts;

  if (next) {
    const span = next.min - dragon.min;          // 이번 구간의 총 길이
    const got = hearts - dragon.min;             // 이번 구간에서 번 것
    $("expFill").style.width = `${(got / span) * 100}%`;
    $("expText").textContent = `다음까지 ${next.min - hearts}`;
  } else {
    $("expFill").style.width = "100%";
    $("expText").textContent = "MAX 🏆";
  }
}

/* ===================================================================
   화면 2 — 일일 미션 모달
   =================================================================== */

function openMission(key) {
  openKey = key;

  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  $("missionDate").textContent = `${m}월 ${d}일 ${WEEKDAY[dow]}요일`;

  renderMissionList();
  renderCheers(key);

  // 주간 일기는 일요일에만 (PRD 기능 ④)
  const isSunday = dow === 0;
  $("diaryArea").hidden = !isSunday;
  if (isSunday) {
    $("diaryText").value = store.diaries[key] ?? "";
    $("diarySaved").classList.remove("show");
    // 미션과 같은 규칙: 그날에만 쓸 수 있습니다.
    // 미션은 잠겼는데 일기만 열려 있으면 앱이 앞뒤가 안 맞습니다.
    const editable = isEditable(key);
    $("diaryText").readOnly = !editable;
    $("diaryText").placeholder = editable
      ? "한 주를 되돌아보며 자유롭게 적어보세요."
      : "지난 일요일의 기록은 확인만 할 수 있어요.";
  }

  $("missionModal").hidden = false;
  applyTheme(countDone(key));
}

function closeMission() {
  // 아직 0.6초를 기다리는 중인 일기가 있으면 지금 바로 저장 (안 그러면 날아감)
  if (openKey && !$("diaryArea").hidden) {
    clearTimeout(diaryTimer);
    saveDiary(openKey, false);
    cleanDiary(openKey);   // blur를 놓치고 닫는 경우까지 확실히 처리
  }
  $("missionModal").hidden = true;
  openKey = null;
  resetTheme();
}

/**
 * 오늘 날짜인가?
 * 미션 체크는 당일에만 할 수 있습니다. 지난 날은 몰아서 채우는 걸 막고,
 * 앞날은 미리 찍는 걸 막습니다. 매일 하는 습관을 만드는 앱이니까요.
 */
function isEditable(key) {
  return key === todayKey();
}

/** 체크박스 4개를 그림 */
function renderMissionList() {
  const mission = getMission(openKey);
  const list = $("missionList");
  const editable = isEditable(openKey);

  // 오늘이 아니면 왜 못 고치는지 알려줍니다
  const note = $("lockNote");
  if (editable) {
    note.hidden = true;
  } else {
    note.hidden = false;
    note.textContent =
      openKey > todayKey()
        ? "🔒 아직 오지 않은 날이에요. 그날이 되면 체크할 수 있어요."
        : "🔒 지난 날은 확인만 할 수 있어요. 미션은 그날에만 체크할 수 있답니다.";
  }

  // 선생님 과제 3개는 매번 새로 그림 (자율학습 줄은 HTML에 있으니 건드리지 않음)
  list.querySelectorAll(".teacher-item").forEach((el) => el.remove());

  TEACHER_TASKS.forEach((label, i) => {
    const item = document.createElement("label");
    item.className = "mission-item teacher-item";
    if (mission.tasks[i]) item.classList.add("done");
    if (!editable) item.classList.add("locked");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = mission.tasks[i];
    cb.disabled = !editable;
    cb.addEventListener("change", () => {
      if (!isEditable(openKey)) return;   // 안전장치
      mission.tasks[i] = cb.checked;
      save();
      afterCheck();
    });

    const mark = document.createElement("span");
    mark.className = "checkmark";

    const text = document.createElement("span");
    text.className = "mission-label";
    text.textContent = label;

    item.append(cb, mark, text);
    list.insertBefore(item, list.querySelector(".custom-item"));
  });

  // 자율 학습 줄
  const customItem = list.querySelector(".custom-item");
  const customCheck = $("customCheck");
  const customText = $("customText");
  const customMark = $("customMark");

  customText.value = mission.custom.text;
  customCheck.checked = mission.custom.done;
  customText.readOnly = !editable;
  customItem.classList.toggle("locked", !editable);
  syncCustomRow();

  function syncCustomRow() {
    const hasText = customText.value.trim().length > 0;
    const on = customCheck.checked && hasText;
    customCheck.disabled = !hasText || !editable;
    customMark.setAttribute("aria-checked", String(on));
    customMark.classList.toggle("locked", !hasText || !editable);
    // 안내 문구는 오늘이면서 아직 안 적었을 때만
    $("customHint").hidden = hasText || !editable;
    customItem.classList.toggle("done", on);
  }

  function toggleCustom() {
    if (!isEditable(openKey)) return;       // 오늘만 체크 가능
    if (!customText.value.trim()) return;   // 내용 없이는 체크 못 함
    customCheck.checked = !customCheck.checked;
    mission.custom.done = customCheck.checked;
    save();
    syncCustomRow();
    afterCheck();
  }

  customText.oninput = () => {
    if (!isEditable(openKey)) return;
    mission.custom.text = customText.value;
    // 내용을 지우면 체크도 함께 풀림 (빈 자율학습이 하트로 세어지면 안 되니까)
    if (!customText.value.trim()) {
      mission.custom.done = false;
      customCheck.checked = false;
    }
    save();
    syncCustomRow();
    afterCheck();
  };

  customMark.onclick = toggleCustom;
  customMark.onkeydown = (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleCustom(); }
  };

  updateProgress();
}

/** 체크가 바뀔 때마다 — 색, 진행도, 캘린더, 캐릭터를 전부 갱신 */
function afterCheck() {
  const done = countDone(openKey);
  applyTheme(done);
  updateProgress();
  renderCalendar();
  renderCharacter();

  // 4칸 완료 = 팡파르 (PRD 기능 ①)
  if (done === 4) celebrate();
  else if (lastCelebrated === openKey) lastCelebrated = null;   // 풀렸으면 다시 축하할 수 있게

  checkLevelUp();
  sendProgress(openKey, done);
}

/* ===================================================================
   진화 축하 팝업 (PRD 기능 ②)

   진화는 이 앱의 정체성인데, 캐릭터 카드의 이모지가 조용히 바뀌는 것만으로는
   학생이 알아채지 못하고 지나갑니다. 레벨이 오른 순간을 확실히 보여줍니다.
   =================================================================== */

// 앱을 켤 때의 레벨. 여기서 초기화하지 않고 첫 체크 때 초기화하면,
// 하필 그 체크로 레벨이 오른 학생이 팝업을 못 보고 지나갑니다.
let shownLevel = 1;
let shownMonth = null;

function checkLevelUp() {
  // ★ 달이 바뀌면 기준을 다시 잡습니다 ★
  //   이게 없으면 이렇습니다: 7월에 Lv.5까지 갔다가 8월 1일에 알로
  //   리셋되면 레벨은 1인데 shownLevel은 5로 남습니다. 그러면 8월 내내
  //   "1 <= 5" 라서 축하 팝업이 한 번도 안 뜹니다.
  const mk = thisMonth();
  if (mk !== shownMonth) {
    shownMonth = mk;
    shownLevel = dragonOf(monthHearts(mk)).level;
  }

  const hearts = monthHearts();
  const now = dragonOf(hearts);
  if (now.level <= shownLevel) return;

  const before = DRAGONS[shownLevel - 1];
  shownLevel = now.level;

  $("levelOld").textContent = before?.emoji ?? "🥚";
  $("levelNew").textContent = now.emoji;
  $("levelLv").textContent = `Lv.${now.level}`;
  $("levelName").textContent = now.name;
  $("levelBubble").textContent = now.bubble;
  $("levelHearts").textContent = hearts;
  $("levelModal").hidden = false;

  celebrateBurst();
}

/* ===================================================================
   익명 진도 보고 (교사용 통계)
   =================================================================== */

let reportTimer = null;

/**
 * 체크할 때마다 바로 보내면, 4개를 연달아 누르는 흔한 동작에
 * 요청이 4번 나갑니다. 1.2초 모았다가 마지막 값만 보냅니다.
 */
function sendProgress(key, count) {
  if (!isConfigured() || !key) return;

  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    reportProgress(key, deviceId(), count).catch((e) => {
      // 통계는 부가 기능입니다. 실패해도 학생의 앱은 멀쩡해야 합니다.
      console.warn("진도 보고 실패:", e);
    });
  }, 1200);
}

function updateProgress() {
  const done = countDone(openKey);
  $("progressText").textContent = `${done} / 4`;
  $("progressHearts").textContent =
    done === 4 ? "⭐⭐⭐⭐" : "❤️".repeat(done) + "🤍".repeat(4 - done);

  // 선생님 과제 줄의 done 표시 갱신
  const mission = getMission(openKey);
  document.querySelectorAll(".teacher-item").forEach((el, i) => {
    el.classList.toggle("done", !!mission.tasks[i]);
  });
}

/* ===================================================================
   4칸 완료 팡파르 — 꽃가루
   =================================================================== */

let confettiFn = null;
let lastCelebrated = null;

/** 꽃가루 터뜨리기 — 4칸 달성과 진화 축하가 같이 씁니다 */
async function celebrateBurst() {
  try {
    if (!confettiFn) {
      const mod = await import("https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/+esm");
      confettiFn = mod.default;
    }
    const shoot = (x) =>
      confettiFn({
        particleCount: 60,
        spread: 70,
        origin: { x, y: 0.7 },
        colors: ["#F43F5E", "#EC4899", "#FBBF24", "#22C55E", "#3B82F6"],
        zIndex: 100,   // 모달(z-index 50)보다 위에서 터지도록
      });
    shoot(0.25);
    setTimeout(() => shoot(0.75), 150);
    setTimeout(() => shoot(0.5), 300);
  } catch {
    // 인터넷이 없어도 앱은 계속 동작해야 하므로 조용히 넘어감
  }
}

function celebrate() {
  if (lastCelebrated === openKey) return;   // 같은 날 두 번 터지지 않게
  lastCelebrated = openKey;
  celebrateBurst();
}

/* ===================================================================
   화면 2 상단 + 화면 3 — 전체 응원 (Firestore)
   =================================================================== */

function renderCheers(key) {
  const area = $("cheerArea");
  const list = cheers[key] ?? [];

  if (!isConfigured()) {
    area.innerHTML =
      `<div class="cheer-empty">🔧 Firebase 설정 전이에요<br>` +
      `<small>firebase.js에 config를 붙여넣으면 응원이 켜집니다</small></div>`;
    return;
  }

  if (!list.length) {
    area.innerHTML = `<div class="cheer-empty">오늘의 응원 메시지가 없어요</div>`;
    return;
  }

  area.innerHTML = "";
  for (const msg of list) {
    const card = document.createElement("div");
    card.className = "cheer-card";
    card.textContent = msg;      // textContent = HTML 태그가 그대로 글자로 나옴 (보안상 안전)
    area.appendChild(card);
  }
}

/** 지금 보고 있는 달의 응원을 Firestore에서 가져옴 */
async function loadCheers() {
  if (!isConfigured()) return;
  try {
    cheers = await fetchCheersForMonth(viewYear, viewMonth);
    renderCalendar();
    if (openKey) renderCheers(openKey);
  } catch (e) {
    console.warn("응원을 불러오지 못했어요:", e);
  }
}

function openCheerModal() {
  if (!isConfigured()) {
    alert(
      "아직 Firebase 설정을 하지 않았어요.\n\n" +
      "firebase.js 파일을 열어서 firebaseConfig에\n" +
      "Firebase 콘솔에서 복사한 값을 붙여넣어 주세요."
    );
    return;
  }
  $("cheerInput").value = "";
  $("cheerCount").textContent = "0";
  $("cheerModal").hidden = false;
  $("cheerInput").focus();
  loadClassStats();
}

/* ===================================================================
   교사용 — 오늘의 우리 반 (익명 통계)

   ※ 이 화면을 학생 화면이 아니라 학부모/교사 버튼(🧒) 안에 둔 이유:
     PRD 2장이 "타인과의 비교나 랭킹 등 소셜 기능 완전 배제"라고
     못박고 있습니다. 학생 화면에 "6명이 4칸 완료" 같은 걸 띄우면
     랭킹은 아니어도 비교가 됩니다. 교사 전용 화면에 두면
     교사는 반 분위기를 알 수 있고 학생은 자기 성장에만 집중합니다.
   =================================================================== */

async function loadClassStats() {
  const body = $("classBody");
  body.innerHTML = `<div class="class-loading">불러오는 중...</div>`;

  let rows;
  try {
    rows = await fetchDayStats(todayKey());
  } catch (e) {
    console.warn("통계를 불러오지 못했어요:", e);
    body.innerHTML = `<div class="class-loading">통계를 불러오지 못했어요</div>`;
    return;
  }

  if (!rows.length) {
    body.innerHTML =
      `<div class="class-loading">아직 오늘 미션을 시작한 학생이 없어요</div>`;
    return;
  }

  const n = rows.length;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const avg = (total / n).toFixed(1);
  const perfect = rows.filter((r) => r.count === 4).length;

  // 0~4칸 각각 몇 명인지
  const dist = [0, 0, 0, 0, 0];
  for (const r of rows) dist[Math.min(Math.max(r.count, 0), 4)]++;

  const bars = dist.map((cnt, i) => {
    const pct = Math.round((cnt / n) * 100);
    return `
      <div class="dist-row">
        <span class="dist-label">${i}칸</span>
        <div class="dist-track">
          <div class="dist-fill" style="width:${pct}%;background:${THEME_COLORS[i]}"></div>
        </div>
        <span class="dist-count">${cnt}명</span>
      </div>`;
  }).join("");

  body.innerHTML = `
    <div class="class-cards">
      <div class="class-card">
        <div class="class-num">${n}</div>
        <div class="class-cap">시작한 학생</div>
      </div>
      <div class="class-card">
        <div class="class-num">${avg}</div>
        <div class="class-cap">평균 (4칸 만점)</div>
      </div>
      <div class="class-card">
        <div class="class-num">${perfect}</div>
        <div class="class-cap">🎉 완벽 달성</div>
      </div>
    </div>
    <div class="dist">${bars}</div>
    <p class="class-note">
      개인은 표시되지 않아요. 이름도 별명도 저장하지 않습니다.
    </p>`;
}

async function submitCheer() {
  const raw = $("cheerInput").value.trim();
  if (!raw) return;

  // 비속어 걸러내기
  // 모든 학생에게 공개되는 글이라, 몰래 고쳐서 보내지 않고
  // 무엇이 가려졌는지 보여준 뒤 확인을 받습니다.
  const { text: msg, found } = clean(raw);
  if (found.length) {
    const ok = confirm(
      `부적절한 표현이 있어 가렸어요.\n\n` +
      `이렇게 보낼까요?\n\n"${msg}"\n\n` +
      `[취소]를 누르면 다시 고칠 수 있어요.`
    );
    if (!ok) return;
    $("cheerInput").value = msg;
  }

  const btn = $("cheerSubmit");
  btn.disabled = true;
  btn.textContent = "보내는 중...";

  try {
    const key = todayKey();          // 응원은 언제나 "오늘" 날짜로 (PRD 기능 ③)
    await addCheer(key, msg);

    // 서버 왕복을 기다리지 않고 화면에 먼저 반영
    (cheers[key] ||= []).push(msg);
    renderCalendar();
    if (openKey === key) renderCheers(key);

    $("cheerModal").hidden = true;
    alert("응원을 띄웠어요! 🚀\n오늘 접속하는 모든 학생에게 보입니다.");
  } catch (e) {
    console.error(e);

    // 무슨 일인지 알려주지 않으면 고칠 수가 없으니 원인을 그대로 보여줍니다
    const code = e?.code ?? "unknown";
    let hint = "";
    if (code === "permission-denied") {
      hint =
        "\n\n[원인] Firestore 보안 규칙이 쓰기를 막고 있어요." +
        "\n규칙 페이지에서 allow create 규칙을 붙여넣고" +
        "\n[게시] 버튼까지 눌렀는지 확인해 주세요.";
    } else if (code === "unavailable" || code === "failed-precondition") {
      hint =
        "\n\n[원인] 데이터베이스에 연결하지 못했어요." +
        "\nFirestore Database가 실제로 만들어졌는지 확인해 주세요.";
    } else if (code === "not-found") {
      hint = "\n\n[원인] Firestore 데이터베이스가 없습니다.";
    }

    alert(`전송에 실패했어요 😢\n\n오류 코드: ${code}\n${e?.message ?? ""}${hint}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "메시지 띄우기 🚀";
  }
}

/* ===================================================================
   화면 4 — 7일 성장 그래프
   =================================================================== */

let chart = null;
let ChartLib = null;

async function openStats() {
  const hearts = monthHearts();
  const dragon = dragonOf(hearts);

  $("statsEmoji").textContent = dragon.emoji;
  $("statsLevel").textContent = `Lv.${dragon.level}`;
  $("statsName").textContent = dragon.name;
  $("statsHearts").textContent = hearts;
  $("statsModal").hidden = false;

  // 최근 7일 (오늘 포함)
  const labels = [];
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    data.push(countDone(dateKey(d)));
  }

  const canvas = $("weekChart");
  if (!canvas) return;   // 앞서 그래프 대신 글자를 넣었던 상태

  try {
    // /auto 경로를 쓰면 막대·축 같은 부품이 자동 등록됩니다.
    // 그냥 chart.js를 불러오면 registerables를 직접 등록해야 해서 잘 막힙니다.
    if (!ChartLib) {
      const m = await import("https://cdn.jsdelivr.net/npm/chart.js@4.4.3/auto/+esm");
      ChartLib = m.default;
    }
    const Chart = ChartLib;
    chart?.destroy();

    chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: data.map((v) => THEME_COLORS[v]),
          borderRadius: 6,
          barPercentage: 0.62,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            max: 4,
            ticks: { stepSize: 1, font: { size: 11 } },
            grid: { color: "#F1F5F9" },
          },
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        },
      },
    });
  } catch (e) {
    // 인터넷이 끊겨 Chart.js를 못 받아도 숫자로는 보여줍니다
    console.warn("그래프를 그리지 못했어요:", e);
    const box = canvas.parentElement;
    if (box) {
      box.innerHTML =
        `<div style="padding:40px 0;color:#64748B;font-size:13px">` +
        `최근 7일 합계: ${data.reduce((a, b) => a + b, 0)} / 28칸</div>`;
    }
  }
}

/* ===================================================================
   주간 일기 — 타이핑 자동 저장 (PRD 기능 ④)
   =================================================================== */

let diaryTimer = null;

$("diaryText").addEventListener("input", () => {
  if (!openKey) return;

  // ★ openKey를 여기서 붙잡아 둡니다.
  //   0.6초 뒤 타이머가 터질 때 openKey를 읽으면, 그 사이에 모달을 닫은 경우
  //   openKey가 null이라 store.diaries[null]에 저장되어 일기가 사라집니다.
  const key = openKey;

  clearTimeout(diaryTimer);
  diaryTimer = setTimeout(() => saveDiary(key, true), 600);
});

function saveDiary(key, showTag) {
  if (!key) return;
  store.diaries[key] = $("diaryText").value;
  save();
  if (!showTag) return;
  const tag = $("diarySaved");
  tag.textContent = "✓ 저장했어요";
  tag.classList.add("show");
  setTimeout(() => tag.classList.remove("show"), 1600);
}

/**
 * 일기 비속어 처리 — 타이핑 중이 아니라 입력창을 벗어날 때만 합니다.
 *
 * 왜 타이핑 중에 하면 안 되나:
 *   "시발점"을 쓰려면 "시"→"시발"→"시발점" 순서를 거칩니다.
 *   실시간으로 가리면 "시발"이 되는 순간 "●●"로 바뀌어서
 *   "시발점"을 아예 쓸 수 없게 됩니다.
 *   글을 다 쓴 뒤에 검사하면 화이트리스트가 "시발점"을 알아봅니다.
 */
function cleanDiary(key) {
  if (!key) return;
  const box = $("diaryText");
  const { text, found } = clean(box.value);
  if (!found.length) return;

  box.value = text;
  store.diaries[key] = text;
  save();

  const tag = $("diarySaved");
  tag.textContent = "부적절한 표현을 가렸어요";
  tag.classList.add("show", "warn");
  setTimeout(() => tag.classList.remove("show", "warn"), 2600);
}

$("diaryText").addEventListener("blur", () => cleanDiary(openKey));

/* ===================================================================
   이벤트 연결
   =================================================================== */

$("prevMonth").onclick = () => {
  viewMonth--;
  if (viewMonth < 1) { viewMonth = 12; viewYear--; }
  renderCalendar();
  loadCheers();
};

$("nextMonth").onclick = () => {
  viewMonth++;
  if (viewMonth > 12) { viewMonth = 1; viewYear++; }
  renderCalendar();
  loadCheers();
};

$("missionClose").onclick = closeMission;
$("charCard").onclick = openStats;
$("statsClose").onclick = () => { $("statsModal").hidden = true; };
$("levelClose").onclick = () => { $("levelModal").hidden = true; };
$("cheerBtn").onclick = openCheerModal;
$("cheerCancel").onclick = () => { $("cheerModal").hidden = true; };
$("cheerSubmit").onclick = submitCheer;

$("cheerInput").addEventListener("input", (e) => {
  $("cheerCount").textContent = e.target.value.length;
});

// 어두운 배경을 누르면 닫기
// (레벨업 팝업은 일부러 뺐습니다. 진화는 이 앱에서 제일 중요한 순간이라
//  실수로 배경을 눌러 지나치지 않도록 버튼으로만 닫게 합니다.)
for (const id of ["missionModal", "cheerModal", "statsModal"]) {
  $(id).addEventListener("click", (e) => {
    if (e.target !== e.currentTarget) return;   // 내용물 클릭은 무시
    if (id === "missionModal") closeMission();
    else $(id).hidden = true;
  });
}

// ESC로 닫기 — 위에 뜬 것부터
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("levelModal").hidden) $("levelModal").hidden = true;
  else if (!$("cheerModal").hidden) $("cheerModal").hidden = true;
  else if (!$("statsModal").hidden) $("statsModal").hidden = true;
  else if (!$("missionModal").hidden) closeMission();
});

/* ===================================================================
   시작!
   =================================================================== */

shownMonth = thisMonth();
shownLevel = dragonOf(monthHearts()).level;   // 켤 때의 레벨을 잡아둠

renderCalendar();
renderCharacter();
resetTheme();
loadCheers();     // Firebase 설정 전이면 조용히 아무것도 안 함

// 앱을 켜둔 채 자정을 넘겨 날짜/달이 바뀌는 경우.
// 화면으로 돌아올 때 다시 그려주지 않으면 어제 날짜를 오늘로 알고 있게 됩니다.
let lastSeenDay = todayKey();
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (todayKey() === lastSeenDay) return;
  lastSeenDay = todayKey();
  renderCalendar();
  renderCharacter();
  resetTheme();
  if (openKey) renderMissionList();   // 어제 열어둔 모달이 있으면 잠금 상태를 갱신
});
