// 글자 서식 코드 정리 시험: node tools/test_text_clean.js
// index.html 의 cleanCadLines(raw) 함수 본문을 그대로 꺼내서(복사본이 아님) 표로 확인한다.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = src.indexOf('cleanCadLines(raw) {');
if (start < 0) { console.error('cleanCadLines 를 찾지 못함'); process.exit(2); }
let i = src.indexOf('{', start), depth = 0, end = -1;
for (let k = i; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (depth === 0) { end = k; break; } } }
const body = src.slice(i + 1, end);
const clean = new Function('raw', body);

const cases = [
  ['줄바꿈 \\P', 'A\\PB', ['A', 'B']],
  ['글꼴 지정 {\\f...;}', '{\\fMalgun Gothic|b0|i0|c129|p34;한글}', ['한글']],
  ['글자 높이 {\\H0.7x;}', '{\\H0.7x;작게}', ['작게']],
  ['글자 높이 \\H2.5; (중괄호 없음)', '\\H2.5;크게', ['크게']],
  ['지름 %%c · 도 %%d · 플러스마이너스 %%p', '%%c10 %%d %%p', ['Ø10 ° ±']],
  ['%%nnn 문자 코드', '%%176C', ['°C']],
  ['밑줄·윗줄 토글 %%u %%o', '%%uUnder%%u %%oOver%%o', ['Under Over']],
  ['분수 \\S1/2;', '3 \\S1/2;', ['3 1/2']],
  ['위첨자 \\S2^;', 'x\\S2^;', ['x2']],
  ['밑줄·윗줄 \\L \\l \\O \\o', '\\L밑줄\\l \\O윗줄\\o', ['밑줄 윗줄']],
  ['유니코드 \\U+00B1', '\\U+00B1 5', ['± 5']],
  ['중첩 {\\C1;{\\H0.8x;중첩}}', '{\\C1;{\\H0.8x;중첩}}', ['중첩']],
  ['줄 안 공백 \\~', 'a\\~b', ['a b']],
  ['문단 정렬 \\pxqc;', '\\pxqc;텍스트', ['텍스트']],
  ['너비·간격 \\W0.8;\\T1.2;', '\\W0.8;\\T1.2;글', ['글']],
  ['정렬 \\A1;', '\\A1;위', ['위']],
  ['색 \\c255;', '\\c255;빨강', ['빨강']],
  ['한글과 영문 그대로', '한글 TEXT 123', ['한글 TEXT 123']],
  ['빈 글자', '', []],
  ['서식만 있는 글자', '{\\fArial;}', []],
  ['역슬래시 이스케이프 \\\\', 'a\\\\b', ['a\\b']],
  ['중괄호 이스케이프 \\{ \\}', '\\{x\\}', ['{x}']],
];
let fails = 0;
for (const [name, input, want] of cases) {
  const got = clean(input);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? '  OK  ' : ' FAIL ') + name + (ok ? '' : `\n         입력 ${JSON.stringify(input)}\n         기대 ${JSON.stringify(want)}\n         실제 ${JSON.stringify(got)}`));
}
console.log(fails ? `\n>> 실패 ${fails}건` : '\n>> 모두 통과 <<');
process.exit(fails ? 1 : 0);
