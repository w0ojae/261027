# Lazy Day · GitHub Pages 업로드 안내

최신 작업 v41 · 2026-10-27 · 원본 커밋 317281f4524f0ee4be0b668ea6e4f3328afb2dfe

이 ZIP은 웹 실행 파일 68개를 모두 포함한 전체 배포본입니다. 건물 모델, Three.js, SUIT 웹 폰트와 라이선스, 창문 빗물과 물리, 실내·정원 이동, 의자 상호작용, 셰이더, 새, 시작 화면, 5분 하루, 부드러운 UI 색상 전환, NPC 직원 1명과 손님 6명, 손님의 착석·계단 이동이 포함됩니다. SUIT 폰트와 1인칭 이동 속도 변경까지 반영했습니다.

## GitHub에 올리는 순서

1. Lazy-Day-GitHub-Pages-v41-2026-10-27.zip을 압축 해제합니다.
2. GitHub 저장소에서 Add file 메뉴의 Upload files를 선택합니다.
3. 압축을 푼 폴더 안의 파일과 하위 폴더를 전부 업로드합니다. 저장소 최상위에서 index.html, main-garden.js, style.css와 assets, vendor, rain, weather, style 폴더가 바로 보여야 합니다.
4. .nojekyll과 _config.yml도 함께 올립니다. 기존 파일이 있으면 이번 파일로 교체한 뒤 변경을 저장합니다.
5. 저장소 Settings의 Pages에서 Source를 Deploy from a branch로 설정합니다.
6. Branch는 업로드한 브랜치(main 등), 폴더는 /(root)로 선택하고 Save를 누릅니다.
7. 배포가 완료되면 Pages 설정에 표시되는 주소를 엽니다. w0ojae 계정의 261013 저장소라면 https://w0ojae.github.io/261013/ 입니다.

ZIP 자체를 업로드하는 대신 압축을 푼 내용물을 올리세요. 상위 폴더나 dist 폴더째 넣어서 index.html이 한 단계 안쪽에 들어가지 않도록 확인하세요. 개발용 소스 백업 ZIP을 이 배포본과 섞을 필요는 없습니다. 이번 배포본은 100개 미만의 파일이며 가장 큰 파일도 웹 업로드 제한인 25MiB 미만입니다.

## 파일 누락 확인

- 최상위: index.html, main-garden.js, style.css, .nojekyll, _config.yml
- 건물: assets/building2.glb
- 폰트: assets/fonts/SUIT-Variable.woff2, SUIT-LICENSE.txt
- 엔진: vendor/three.module.js, vendor/three.core.js와 하위 모듈
- 빗물: rain/assets/drop-alpha.png, rain/assets/drop-color.png와 관련 코드
- NPC: cafe-npcs.js, npc-character.js, npc-navigation.js, npc-placement.js, npc-destinations.js

모든 실행 경로는 상대 경로이며 저장소 이름이 붙는 GitHub Pages 하위 경로에서 실행됩니다. 별도 npm 설치, 빌드, API 키 없이 실행할 수 있습니다. 폰트도 ZIP에 포함되어 Google Fonts 연결이 필요하지 않습니다. 파일을 더블클릭하는 대신 GitHub Pages의 HTTPS 주소에서 실행하세요.

Pages 배포 완료 후에도 예전 화면이 남으면 새로고침하세요. 404가 나오면 먼저 저장소 최상위 index.html과 Pages의 브랜치 및 /(root) 설정을 확인하세요. vendor 폴더가 빠지면 3D 화면이 열리지 않으므로 .nojekyll과 _config.yml을 유지하세요.

## 백업과 출처

개발용 전체 소스는 Lazy-Day-Source-Backup-v41-2026-10-27.zip에 별도로 보관했습니다. 원본 dist 파일은 바이트 그대로 보존했습니다. Git 이력, 호스팅 관리용 .openai, 캐시와 인증 정보는 내보내지 않았습니다. backup-manifest.json에는 파일별 크기와 SHA-256이 들어 있습니다.

vendor/THREE-LICENSE.txt, rain/THIRD_PARTY_NOTICES.md, assets/fonts/SUIT-LICENSE.txt와 폰트 README를 유지하세요.

공식 Pages 설정 안내: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
공식 파일 업로드 안내: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
