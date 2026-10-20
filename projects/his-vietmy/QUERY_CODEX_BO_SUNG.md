# Việc cho Codex: bổ sung `PROMPT_TEST_IVF.md` (v7 → v7.1)

Mở `PROMPT_TEST_IVF.md`. Sửa đúng 8 chỗ dưới đây. Không đụng phần còn lại. Chép nguyên văn khối thay thế, không diễn đạt lại. Xong thì đổi tiêu đề dòng 1 thành `v7.1`.

Sau đó tạo hai thứ mà prompt vừa nhắc tới:
1. `QC/config/banned_phrases.txt`: mỗi dòng một cụm cấm, lấy từ mục 6.13 mới.
2. Trong `QC/scripts/export_excel.py`: thêm lệnh `upsert --id <ID>` (ghi một dòng, nguyên tử, khóa thì thử lại 3 lần rồi ghi `testcases_pending.jsonl`), thêm sheet "Báo cáo ngày" (số đếm bằng công thức COUNTIFS trên sheet "Lịch sử chạy"), và quét `banned_phrases.txt` trước khi lưu (gặp cụm cấm thì in ô và dòng, không lưu).

Chạy thử hai lệnh: `upsert` một testcase mẫu và `daily_report`. Mở lại Excel bằng openpyxl, kiểm: Tags có đúng hai giá trị, Evidence là HYPERLINK trỏ tới ảnh có thật, sheet "Báo cáo ngày" có đúng một dòng cho hôm nay. Chưa chạy được thì ghi "Chưa chạy", không báo xong.

## 1. Dòng 38 (mục 2, "Nhịp ghi chép")
Thay cụm `mỗi khoảng 20 testcase: ghi Excel, cập nhật` bằng:
`ghi Excel sau MỖI testcase (mục 11); mỗi khoảng 20 testcase: cập nhật`

## 2. Dòng 116 (mục 6, luật 13) thay cả luật bằng
13. **Văn phong** (áp cho MỌI chữ bạn viết: ô Excel, báo cáo ngày, mô tả bug, mọi tệp `.md` trong QC, `RUNLOG.md`, thông điệp commit của code test):
    - Viết như người trong team nói chuyện. Câu ngắn. Rồi một câu dài hơn để giải thích vì sao hoặc kể điều kiện. Rồi lại ngắn. Nói thẳng cái gì sai, ở đâu, thấy lúc nào.
    - Vào việc luôn. Không mở bài, không kết bài, không "tóm lại".
    - **CẤM** các cụm: "Trong kỷ nguyên số", "Hành trình", "Đột phá", "Thách thức", "Ngày nay", "Đáng chú ý", "Tóm lại", "Nhìn chung", "Không thể phủ nhận", "Điều quan trọng là", "Cần lưu ý rằng", "Có thể thấy", "Bên cạnh đó", "Hơn nữa", "Toàn diện", "Tối ưu hóa", "Nâng tầm", "Tiên phong". Không dùng "rất", "vô cùng", "cực kỳ" để nhấn.
    - Sai: "Đáng chú ý, hệ thống gặp thách thức khi xử lý sinh hiệu." Đúng: "Nhập mạch 29, bấm Lưu. Hệ thống vẫn lưu. Spec nói phải khóa nút."
    - Danh sách cấm nằm ở `QC/config/banned_phrases.txt`. `export_excel.py` và `daily_report` quét tệp này trước khi lưu. Gặp cụm cấm thì viết lại câu đó, không xóa bừa cả ô.

## 3. Dòng 219 (mục 11, Title và Tags) thay cả dòng bằng
- Title: `[IVF_<Module>] <tiêu đề>`.
- **Tags luôn có đúng hai giá trị: `<Bug|Task>, <Low|Medium|High>`.** Bug = testcase Fail đã xác minh hai lần. Task = Pass, Chưa chạy, Blocked, hoặc việc cần làm tiếp. Mức của Bug lấy theo Severity (Critical gộp vào High trong cột Tags; cột Severity vẫn ghi Critical). Mức của Task lấy theo Priority (P1 = High, P2 = Medium, P3/P4 = Low). Lệch SPEC-SH thì thêm giá trị thứ ba: "Cần BA xác nhận".

## 4. Dòng 221 (mục 11, Evidence) thay cả dòng bằng
- **Evidence** là `=HYPERLINK("evidence/YYYY-MM-DD/<file>.png","Xem ảnh")`. Bấm vào là mở thẳng ảnh. Đường dẫn tương đối, workbook và thư mục `evidence/` nằm cùng cấp. Tối đa 3 ảnh, cột Evidence 1, 2, 3. Chưa có ảnh thì để trống, không tạo link chết. Testcase Fail bắt buộc có ảnh viền đỏ.

## 5. Dòng 222 (mục 11, danh sách sheet)
Thay `Sheet thêm: "Lịch sử chạy"` bằng `Sheet thêm: "Báo cáo ngày", "Lịch sử chạy"`

## 6. Dòng 223 (mục 11, "Điền sau mỗi đợt ~20 testcase") thay cả dòng bằng
- **Ghi ngay, không dồn.**
  1. **Ghi trước khi chạy.** Soạn xong testcase nào là ghi dòng đó vào Excel luôn: Title, Description, Step, Expected, Tags, Priority, Severity, Kỹ thuật, Manual/Auto. Kết quả "Chưa chạy"; Actual và Evidence để trống. Soạn cả module xong mới ghi là sai.
  2. **Ghi ngay sau mỗi testcase.** Chạy xong một testcase: điền Actual, Kết quả, Tags, Evidence, Commit, Bug ID vào đúng dòng đó, lưu file, rồi mới sang testcase kế. Không gom 20 cái.
  3. Mỗi lần ghi là một lệnh: `python3 scripts/export_excel.py upsert --id <ID>`. Ghi nguyên tử (ghi tệp tạm rồi đổi tên). Excel đang bị khóa thì chờ 5 giây, thử 3 lần, rồi để lại trong `QC/testcases_pending.jsonl` và đồng bộ ở lần ghi sau.
  4. Ngay khi chạy xong, trước cả Excel, ghi một dòng JSON vào `runs/<module>/results.jsonl`. Excel hỏng hay mất thì dựng lại từ tệp này.
  5. Testcase soạn rồi mà chưa chạy được vẫn nằm trong Excel với Kết quả "Chưa chạy", không tính vào số "đã chạy".
  6. Mỗi ~20 testcase: tự kiểm (bên dưới), cập nhật `PROGRESS.md`, thêm dòng heartbeat vào `RUNLOG.md`. Đây là bước kiểm tra, không phải lúc mới ghi.
- **Sheet "Báo cáo ngày"** (bảng "hôm nay làm được gì"). Mỗi ngày làm việc thêm **một dòng**, không sửa dòng ngày cũ. Cột: Ngày | Commit (trước → sau) | Module đã làm | Việc đã làm | Đã chạy | Pass | Fail | Blocked | Chưa chạy | Auto | Manual | Bug mới | Bug đổi trạng thái | Bug còn mở | Hồi quy | Vướng | Ngày mai làm gì.
  - Các cột số là công thức `COUNTIFS` trên sheet "Lịch sử chạy" theo ngày, không gõ tay.
  - "Việc đã làm": 1 đến 3 câu theo văn phong mục 6.13, nêu module và chức năng đã đụng tới. Ví dụ: "Đơn thuốc: chạy 18 testcase, 3 Fail. Sửa đơn đã ký qua API vẫn nhận. Đã gắn BUG-014." Không chung chung.
  - Ngày không test được thì vẫn một dòng: số bằng 0, cột "Vướng" ghi đúng lý do.

## 7. Mục 14 (lịch)
Đổi `Cài **4 việc**` thành `Cài **3 việc**`. Xóa hai dòng `08:30 daily_pull` và `09:00 daily_work`, thay bằng hai dòng này (dòng `22:00 nightly` giữ nguyên):
| 08:30 | `daily_run` | Một việc liền, không tách. **(1) Mục 3.1 đến 3.3:** pull PROJECT (`git fetch --all --prune`, `git pull --ff-only`) và `_kit` (`git pull`), ghi `changes/`, dựng lại stack, kiểm chứng build, smoke đăng nhập hai role, phân tích ảnh hưởng, xếp lại `BACKLOG.md`. Pull lỗi: ghi lỗi nguyên văn, không force, giữ code hiện có. **(2) Rồi đọc `STATE.md` và làm hàng đợi mục 2 liên tục, đến khi hết hạn mức hoặc 16:45.** Đây là việc chính. Không có lịch 09:00 |
| 17:00 | `daily_report` | Theo thứ tự: (1) ghi nốt mọi dòng còn thiếu vào Excel (kể cả "Chưa chạy"); (2) thêm dòng của hôm nay vào sheet "Báo cáo ngày"; (3) xuất `QC/reports/bao_cao_YYYY-MM-DD.md` có bảng "Hôm nay làm được gì" (mục 15); (4) xuất `QC/testcases_YYYY-MM-DD.xlsx`; (5) tự kiểm mọi HYPERLINK trỏ tới ảnh có thật; (6) quét cụm cấm (mục 6.13). Hôm đó không test được thì vẫn xuất, ghi đúng lý do. Việc `daily_run` còn đang chạy thì `daily_report` vẫn chạy, rồi `daily_run` ghi tiếp vào dòng của ngày |

## 8. Mục 15, ngay trước câu "Chỉ ghi việc có bằng chứng." thêm
- **Bảng "Hôm nay làm được gì"** ngay đầu báo cáo, mỗi module đã đụng tới một dòng: Module | Đã chạy | Pass | Fail | Blocked | Việc cụ thể đã làm | Bug (ID) | Ảnh chính (link). Số lấy từ Excel, khớp sheet "Báo cáo ngày".
