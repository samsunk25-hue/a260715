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
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE.appspot.com",
  messagingSenderId: "PASTE",
  appId: "PASTE",
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
   ③ 응원 쓰기 — addDoc (setDoc이 아님!)
      setDoc은 같은 날 앞사람 메시지를 덮어써서 지워버립니다.
      addDoc은 새 문서를 추가하므로 여러 개가 쌓입니다.
   ------------------------------------------------------------------- */
export async function addCheer(dateKey, message) {
  const conn = await connect();
  if (!conn) throw new Error("NOT_CONFIGURED");

  const { db, fs } = conn;
  await fs.addDoc(fs.collection(db, "cheers"), {
    date: dateKey,                     // "2026-07-15" — 문서 ID가 아니라 필드!
    message: message.trim(),
    createdAt: fs.serverTimestamp(),
  });
}

/* -------------------------------------------------------------------
   ④ 응원 읽기 — 한 달치를 한 번에

      날짜를 필드로 뒀기 때문에 범위 쿼리 하나로 그 달 전체가 들어옵니다.
      덕분에 캘린더 뱃지와 모달의 응원 카드가 조회 1번으로 같이 해결됩니다.

      반환값: { "2026-07-15": ["메시지1", "메시지2"], ... }
   ------------------------------------------------------------------- */
export async function fetchCheersForMonth(year, month /* 1~12 */) {
  const conn = await connect();
  if (!conn) return {};

  const { db, fs } = conn;
  const pad = (n) => String(n).padStart(2, "0");
  const last = new Date(year, month, 0).getDate();     // 그 달의 마지막 날
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(last)}`;

  // ※ orderBy를 쓰지 않는 이유:
  //   where(date) + orderBy(createdAt)처럼 서로 다른 필드를 섞으면
  //   Firestore가 "복합 색인을 만들라"며 에러를 냅니다.
  //   아래에서 JS로 정렬하면 그 문제 자체가 없습니다.
  const snap = await fs.getDocs(
    fs.query(
      fs.collection(db, "cheers"),
      fs.where("date", ">=", from),
      fs.where("date", "<=", to)
    )
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
