# 22 phép nghiệm thu trong kế hoạch

Trạng thái chỉ được nâng khi có kiểm tra tự động hoặc bằng chứng chạy trên dự án tương ứng.

| # | Phép nghiệm thu | Trạng thái | Còn thiếu |
|---:|---|---|---|
| 1 | Selftest bắt fixture lỗi, chạy lặp lại ổn định | Một lượt fixture đạt | Chưa chạy cùng lệnh hai lần và so toàn bộ kết quả trong accept |
| 2 | Thiếu `.env.app` thì daily dừng trước testcase | Có cổng `env` và `run` trả BLOCKED | Chưa có daily pipeline; chưa kiểm test không phát sinh |
| 3 | Thiếu khóa liệt kê tên khóa, không lộ giá trị | Có kiểm tra key và không in value | Chưa có fixture acceptance khóa thiếu |
| 4 | Stack tắt thì ready dừng sau hạn chờ | `ready` chặn khi endpoint không khỏe | Chưa có retry window / thời hạn chờ cấu hình |
| 5 | Login sai chặn role và chụp evidence | Chưa làm | Auth adapter chưa có |
| 6 | Chạy lặp không nhân dòng testcase | Upsert theo ID; báo cáo một dòng/ngày; execution ID giữ lịch sử lần chạy | Chưa kiểm thử end-to-end chạy cùng suite hai lần |
| 7 | Hai phiên chạy song song bị khóa | Đã kiểm cross-process trên fixture tổng hợp | `.qa.lock` theo dự án và claim nguyên tử chặn tiến trình thứ hai; chưa có lệnh `qa daily` để diễn tập chuỗi đầy đủ |
| 8 | Resume bỏ qua testcase đã ghi | Đã kiểm trên fixture tổng hợp | `qa run --resume` dùng lại `run_id` và bỏ ID đã có trong JSONL; chưa diễn tập kill tiến trình runner thật trên app HIS |
| 9 | Evidence Fail mở ảnh viền đỏ từ Excel | Có screenshot runner; link `HYPERLINK` tới ảnh fixture thật trong selftest | Chưa kiểm trên workbook mở bằng ứng dụng Excel/LibreOffice |
| 10 | Cụm cấm chặn lưu và báo ô/dòng | Có quét trước export | Chưa có fixture acceptance bắt câu vi phạm và chỉ ra ô/dòng |
| 11 | Tắt AI vẫn hoàn tất daily/report | Core hiện không gọi AI | Daily pipeline chưa có |
| 12 | Lỗi cùng chữ ký tăng hits | Đạt trên fixture tổng hợp | `qa bug report` chuẩn hóa và băm chữ ký; selftest xác nhận cùng chữ ký tăng hits; chưa diễn tập trên dự án thật |
| 13 | Verify bug qua các lượt pass | Đạt trên fixture tổng hợp | `qa bug verify` chỉ đóng khi testcase liên kết có 2 lượt Pass liên tiếp gắn `--bug-id`; chưa diễn tập trên dự án thật |
| 14 | Baseline UI đổi có chủ ý chờ duyệt | Chưa làm | Baseline workflow chưa có |
| 15 | Route/nút mới vào AI queue | Chưa làm | Recon và AI queue chưa có |
| 16 | Bí mật trong log/Excel được che và tạo incident | Actual có redaction cơ bản | Quét file/log toàn diện và incident record chưa có |
| 17 | Dashboard khớp số Excel | Dashboard đọc SQLite; Excel dùng cùng dữ liệu | Chưa có phép so parity đầy đủ |
| 18 | Thêm dự án hai không sửa `core/` | Core profile-driven; HIS/Lumina/template không sửa lõi | Chưa chạy phép diff qua quy trình init dự án thứ hai |
| 19 | Mọi locator được xác minh trên app thật | Chưa làm | Recon và verify-locators chưa có |
| 20 | Smoke trên app thật chạy hai lượt ổn định | Fixture smoke đã chạy | Chưa chạy smoke app thật hai lần |
| 21 | Cài lịch tự chạy daily/report trên máy sạch | Chưa làm | `qa install` và lịch OS chưa có |
| 22 | Watchdog resume phiên bị dừng | Chưa làm | Watchdog chưa có |

Không có phép nghiệm thu nào được tuyên bố đạt hoàn toàn trên HIS hoặc Lumina. Phép thử synthetic xác nhận lõi hoạt động, không thay cho xác minh app thật.
