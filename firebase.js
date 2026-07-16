/* ===================================================================
   firebase.js — 전체 응원 메시지 공유 전용
   -------------------------------------------------------------------
   이 파일은 앱에서 Firebase를 쓰는 "유일한" 곳입니다.
   미션 체크, 하트, 드래곤 레벨, 일기는 전부 localStorage(내 기기)에
   저장되므로 이 파일과 아무 상관이 없습니다.

   ★ 아직 Firebase 설정을 안 했어도 앱은 정상 동작합니다.
     (응원 기능만 잠깐 잠겨 있을 뿐입니다)
   =================================================================== */

/* -------------------------------------------------------------------
   ① 여기에 Firebase 콘솔에서 복사한 firebaseConfig를 붙여넣으세요.
      프로젝트 설정 → 내 앱 → 웹 앱(</>) → firebaseConfig
   ------------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyD4Jfp0sFJ6N6S8E3OnwrLCDzQElg1ozl8",
  authDomain: "study-dragon.firebaseapp.com",
  projectId: "study-dragon",
  storageBucket: "study-dragon.firebasestorage.app",
  messagingSenderId: "767816970944",
  appId: "1:767816970944:web:0cd02989fa106e771af325",
};

/** 설정을 아직 안 붙여넣었는지 검사 */
export function isConfigured() {
  return !String(firebaseConfig.apiKey).startsWith("PASTE");
}

/* -------------------------------------------------------------------
   ② Firebase SDK를 "필요할 때만" 불러옵니다 (지연 로딩).
      설정 전에는 네트워크 요청조차 하지 않으므로 에러가 나지 않습니다.
   ------------------------------------------------------------------- */
const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
let ready = null;

async function connect() {
  if (!isConfigured()) return null;
  if (ready) return ready;

  ready = (async () => {
    const { initializeApp } = await import(SDK + "firebase-app.js");
    const fs = await import(SDK + "firebase-firestore.js");
    const app = initializeApp(firebaseConfig);
    return { db: fs.getFirestore(app), fs };
  })();

  return ready;
}

/* -------------------------------------------------------------------
   ★ 반(class) 나누기 — 조회 열쇠 만들기 ★

   여러 반이 한 앱을 쓰므로 데이터를 반별로 나눠야 합니다.
   그런데 Firestore는 "범위 조건 + 다른 필드 조건"을 섞으면 복합 색인을
   요구합니다. 예: where(class==반) + where(date 범위). 이걸 피하려고
   "반코드|년월"을 한 필드(cm)로 합쳐 단일 등호 조회만 씁니다.
   그러면 색인 문제가 아예 생기지 않습니다.
   ------------------------------------------------------------------- */
const ym = (dateKey) => dateKey.slice(0, 7);              // "2026-07-15" -> "2026-07"
const cmKey = (code, dateKey) => `${code}|${ym(dateKey)}`; // 응원·과제 월단위 열쇠
const cdKey = (code, dateKey) => `${code}|${dateKey}`;     // 통계 일단위 열쇠

/* -------------------------------------------------------------------
   반 만들기 / 확인
     classes/{코드} 문서로 반의 존재를 확인합니다. 학생이 코드를
     잘못 입력하면 "없는 반"이라고 알려줄 수 있습니다.
   ------------------------------------------------------------------- */
export async function classExists(code) {
  const conn = await connect();
  if (!conn) return false;
  const { db, fs } = conn;
  const snap = await fs.getDoc(fs.doc(db, "classes", code));
  return snap.exists();
}

/** 반 정보 가져오기 — { name } 또는 없으면 null */
export async function getClass(code) {
  const conn = await connect();
  if (!conn) return null;
  const { db, fs } = conn;
  const snap = await fs.getDoc(fs.doc(db, "classes", code));
  return snap.exists() ? { name: snap.data().name || "우리 반" } : null;
}

export async function createClass(code, name) {
  const conn = await connect();
  if (!conn) throw new Error("NOT_CONFIGURED");
  const { db, fs } = conn;
  await fs.setDoc(fs.doc(db, "classes", code), {
    name: name || "우리 반",
    createdAt: fs.serverTimestamp(),
  });
}

/* -------------------------------------------------------------------
   ③ 응원 쓰기 — addDoc (setDoc이 아님!)
      setDoc은 같은 날 앞사람 메시지를 덮어써서 지워버립니다.
      addDoc은 새 문서를 추가하므로 여러 개가 쌓입니다.
   ------------------------------------------------------------------- */
export async function addCheer(code, dateKey, message) {
  const conn = await connect();
  if (!conn) throw new Error("NOT_CONFIGURED");

  const { db, fs } = conn;
  await fs.addDoc(fs.collection(db, "cheers"), {
    cm: cmKey(code, dateKey),           // "7A3K|2026-07" — 반별 월 조회 열쇠
    date: dateKey,                      // "2026-07-15"
    message: message.trim(),
    createdAt: fs.serverTimestamp(),
  });
}

/* -------------------------------------------------------------------
   ④-3 선생님 지정 과제 (교사가 직접 편집)

   과제를 날짜별 문서로 저장합니다. "오늘부터의 과제"라는 뜻이라,
   교사가 오늘 과제를 바꿔도 학생이 예전에 체크해둔 날의 과제 이름은
   바뀌지 않습니다. (app.js가 "그 날짜 이하의 최신 과제"를 골라 씁니다.)

   과제는 항상 정확히 3개입니다. 이 개수가 흔들리면 하트 계산(3+자율1=4칸)이
   깨지므로, 앱에서 3개를 모두 채웠을 때만 저장합니다.
   ------------------------------------------------------------------- */
export async function saveTasks(code, dateKey, list) {
  const conn = await connect();
  if (!conn) throw new Error("NOT_CONFIGURED");

  const { db, fs } = conn;
  // 문서 ID에 반코드를 붙입니다. 안 그러면 다른 반이 같은 날짜에 과제를
  // 저장할 때 문서 ID(날짜)가 겹쳐 서로 덮어씁니다.
  await fs.setDoc(fs.doc(db, "tasks", `${code}__${dateKey}`), {
    cm: cmKey(code, dateKey),
    date: dateKey,
    list,                                // ["독서 30분", "수학...", "영어..."]
    updatedAt: fs.serverTimestamp(),
  });
}

/** 그 반, 그 달의 과제 설정 — { "2026-07-01": ["...","...","..."], ... } */
export async function fetchTasksForMonth(code, year, month /* 1~12 */) {
  const conn = await connect();
  if (!conn) return {};

  const { db, fs } = conn;
  const pad = (n) => String(n).padStart(2, "0");
  const cm = `${code}|${year}-${pad(month)}`;

  const snap = await fs.getDocs(
    fs.query(fs.collection(db, "tasks"), fs.where("cm", "==", cm))
  );

  const byDate = {};
  snap.forEach((d) => {
    const v = d.data();
    if (Array.isArray(v.list) && v.list.length === 3) byDate[v.date] = v.list;
  });
  return byDate;
}

/* -------------------------------------------------------------------
   ④-2 익명 진도 보고 (교사용 통계)

   ★ 이름도 별명도 올리지 않습니다 ★
     올라가는 건 { 날짜, 몇 칸 했는지 } 뿐이고, 문서를 구분하기 위한
     기기 ID는 앱이 처음 켜질 때 만든 난수입니다. 사람과 연결되는
     정보가 아예 없어서, 데이터를 다 내려받아도 누가 누구인지
     알아낼 방법이 없습니다.

   문서 ID를 "날짜__기기ID"로 고정한 이유:
     setDoc이 같은 ID에 덮어쓰기 때문에, 학생이 하루에 체크를 몇 번
     바꾸든 그 학생의 오늘 기록은 항상 한 줄로 유지됩니다.
     (응원과 정반대입니다. 응원은 쌓여야 해서 addDoc을 썼습니다.)
   ------------------------------------------------------------------- */
export async function reportProgress(code, dateKey, deviceId, count) {
  const conn = await connect();
  if (!conn) return;

  const { db, fs } = conn;
  await fs.setDoc(fs.doc(db, "stats", `${code}__${dateKey}__${deviceId}`), {
    cd: cdKey(code, dateKey),           // "7A3K|2026-07-16" — 반별 일 조회 열쇠
    date: dateKey,
    count,                              // 0~4
    updatedAt: fs.serverTimestamp(),
  });
}

/** 그 반, 그날 전체 진도 — [{ count }, ...] */
export async function fetchDayStats(code, dateKey) {
  const conn = await connect();
  if (!conn) return [];

  const { db, fs } = conn;
  const snap = await fs.getDocs(
    fs.query(fs.collection(db, "stats"), fs.where("cd", "==", cdKey(code, dateKey)))
  );

  const rows = [];
  snap.forEach((d) => {
    const v = d.data();
    if (typeof v.count === "number") rows.push({ count: v.count });
  });
  return rows;
}

/* -------------------------------------------------------------------
   ④ 응원 읽기 — 한 달치를 한 번에

      날짜를 필드로 뒀기 때문에 범위 쿼리 하나로 그 달 전체가 들어옵니다.
      덕분에 캘린더 뱃지와 모달의 응원 카드가 조회 1번으로 같이 해결됩니다.

      반환값: { "2026-07-15": ["메시지1", "메시지2"], ... }
   ------------------------------------------------------------------- */
export async function fetchCheersForMonth(code, year, month /* 1~12 */) {
  const conn = await connect();
  if (!conn) return {};

  const { db, fs } = conn;
  const pad = (n) => String(n).padStart(2, "0");
  const cm = `${code}|${year}-${pad(month)}`;

  // cm(반코드|년월) 한 필드로만 조회 → 복합 색인이 필요 없습니다.
  // 정렬은 아래에서 JS로 합니다.
  const snap = await fs.getDocs(
    fs.query(fs.collection(db, "cheers"), fs.where("cm", "==", cm))
  );

  const rows = [];
  snap.forEach((d) => rows.push(d.data()));

  // 쓴 순서(오래된 순)로 정렬 — 방금 쓴 글은 serverTimestamp가
  // 아직 null일 수 있어서 맨 뒤로 보냅니다.
  rows.sort((a, b) => {
    const ta = a.createdAt?.seconds ?? Infinity;
    const tb = b.createdAt?.seconds ?? Infinity;
    return ta - tb;
  });

  const byDate = {};
  for (const r of rows) {
    if (!r.date || !r.message) continue;
    (byDate[r.date] ||= []).push(r.message);
  }
  return byDate;
}
