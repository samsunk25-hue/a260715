/* ===================================================================
   과제 수정 비밀번호 바꾸기
   -------------------------------------------------------------------
   쓰는 법 (터미널에서):
     node scripts/새-비밀번호-만들기.mjs  내가원하는비밀번호

   그러면 SHA-256 해시가 출력됩니다. 그 값을 복사해서
   app.js 의 TEACHER_PW_HASH 에 붙여넣고 저장 후 배포하면 됩니다.

   왜 해시로 두나요?
     이 저장소는 GitHub에 공개되어 있습니다. 비밀번호 원문을 코드에
     적으면 누구나 볼 수 있습니다. 해시는 원문으로 되돌리기 어려워서,
     코드가 공개돼도 비밀번호가 바로 드러나지 않습니다.
   =================================================================== */

import { createHash } from "node:crypto";

const pw = process.argv[2];
if (!pw) {
  console.log("사용법: node scripts/새-비밀번호-만들기.mjs  <새 비밀번호>");
  process.exit(1);
}

const hash = createHash("sha256").update(pw).digest("hex");
console.log("");
console.log("  비밀번호 :", pw);
console.log("  해시     :", hash);
console.log("");
console.log("  app.js 의 TEACHER_PW_HASH 값을 위 해시로 바꾸세요.");
console.log("");
