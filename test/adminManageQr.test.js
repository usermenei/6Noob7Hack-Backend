const { uploadQrCode, getQrCode, getQrCodeBySpace } = require("../controllers/payments");

jest.mock("../models/Payment");
jest.mock("../models/Reservation");
jest.mock("../models/QrCode");


const Payment     = require("../models/Payment");
const Reservation = require("../models/Reservation");
const QrCode      = require("../models/QrCode");

// ─── helpers ─────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  res.send   = jest.fn().mockReturnValue(res);
  res.set    = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  body:   {},
  query:  {},
  params: {},
  file:   null,
  user:   { id: "admin-user-id", role: "admin" },
  ...overrides,
});

const makePayment = (extra = {}) => ({
  _id:         "payment-001",
  user:        { toString: () => "user-abc" },
  reservation: "reservation-001",
  method:      "qr",
  status:      "pending",
  amount:      200,
  ...extra,
});

const makeReservation = (extra = {}) => ({
  _id:  "reservation-001",
  room: { coworkingSpace: "space-001" },
  ...extra,
});

const makeQrDoc = (extra = {}) => ({
  _id:       "qr-001",
  mimeType:  "image/png",
  imageData: Buffer.from("fake-image").toString("base64"),
  isActive:  true,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  ...extra,
});

const mockReservationFind = (result) =>
  Reservation.findById.mockReturnValue({
    populate: jest.fn().mockResolvedValue(result),
  });

beforeEach(() => jest.clearAllMocks());

// ─── uploadQrCode ─────────────────────────────────────────────────────────────

describe("uploadQrCode controller", () => {

  // ✅ controller ใช้ findOneAndUpdate (upsert) → คืน status 200 พร้อม uploadedAt
  test("✅ valid PNG — upserts QR, returns 200 with uploadedAt", async () => {
    const updatedAt = new Date("2025-01-01");
    QrCode.findOneAndUpdate.mockResolvedValue({ updatedAt });

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "image/png", buffer: Buffer.from("fake-png"), originalname: "qr.png" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "QR Code updated successfully" })
    );
  });

  test("✅ valid JPG — returns 200", async () => {
    QrCode.findOneAndUpdate.mockResolvedValue({ updatedAt: new Date() });

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "image/jpeg", buffer: Buffer.from("fake-jpg"), originalname: "qr.jpg" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("✅ valid WEBP — returns 200", async () => {
    QrCode.findOneAndUpdate.mockResolvedValue({ updatedAt: new Date() });

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "image/webp", buffer: Buffer.from("fake-webp"), originalname: "qr.webp" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  // ✅ เช็คว่า findOneAndUpdate ถูกเรียกด้วย params ที่ถูกต้อง (upsert pattern)
  test("✅ calls findOneAndUpdate with correct spaceId and isActive:true", async () => {
    const updatedAt = new Date("2025-06-01");
    QrCode.findOneAndUpdate.mockResolvedValue({ updatedAt });

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "image/png", buffer: Buffer.from("new-qr"), originalname: "new-qr.png" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(QrCode.findOneAndUpdate).toHaveBeenCalledWith(
      { coworkingSpace: "space-001" },
      expect.objectContaining({
        $set: expect.objectContaining({
          isActive:   true,
          uploadedBy: "admin-user-id",
          mimeType:   "image/png",
        }),
      }),
      expect.objectContaining({ upsert: true, new: true })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, uploadedAt: updatedAt })
    );
  });

  test("❌ no file attached — returns 400 'No file uploaded'", async () => {
    const req = mockReq({ body: { spaceId: "space-001" }, file: null });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "No file uploaded" })
    );
  });

  test("❌ missing spaceId — returns 400 'spaceId is required'", async () => {
    const req = mockReq({
      body: {},
      file: { mimetype: "image/png", buffer: Buffer.from("x"), originalname: "qr.png" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "spaceId is required" })
    );
  });

  test("❌ DB throws 'Format Not Supported' — returns 400", async () => {
    QrCode.findOneAndUpdate.mockRejectedValue(new Error("Format Not Supported"));

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "application/pdf", buffer: Buffer.from("pdf"), originalname: "file.pdf" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining("Format Not Supported"),
      })
    );
  });
});

// ─── getQrCode ────────────────────────────────────────────────────────────────

describe("getQrCode controller", () => {

  test("✅ owner gets QR — returns 200 with dataUrl and payment info", async () => {
    const payment = makePayment();
    Payment.findById.mockResolvedValue(payment);
    mockReservationFind(makeReservation());
    QrCode.findOne.mockResolvedValue(makeQrDoc());

    const req = mockReq({
      params: { id: "payment-001" },
      user:   { id: "user-abc", role: "user" },
    });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          paymentId: payment._id,
          amount:    payment.amount,
          qrCode:    expect.stringMatching(/^data:image\//),
        }),
      })
    );
  });

  test("✅ admin gets any user's QR", async () => {
    const payment = makePayment({ user: { toString: () => "other-user" } });
    Payment.findById.mockResolvedValue(payment);
    mockReservationFind(makeReservation());
    QrCode.findOne.mockResolvedValue(makeQrDoc());

    const req = mockReq({
      params: { id: "payment-001" },
      user:   { id: "admin-user-id", role: "admin" },
    });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("✅ qrCode field is a base64 data URL", async () => {
    const qrDoc = makeQrDoc({ mimeType: "image/png" });
    Payment.findById.mockResolvedValue(makePayment());
    mockReservationFind(makeReservation());
    QrCode.findOne.mockResolvedValue(qrDoc);

    const req = mockReq({ params: { id: "payment-001" }, user: { id: "user-abc", role: "user" } });
    const res = mockRes();

    await getQrCode(req, res);

    const returned = res.json.mock.calls[0][0];
    expect(returned.data.qrCode).toMatch(/^data:image\/png;base64,/);
  });

  test("❌ payment not found — returns 404", async () => {
    Payment.findById.mockResolvedValue(null);

    const req = mockReq({ params: { id: "nonexistent" }, user: { id: "user-abc", role: "user" } });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Payment not found" })
    );
  });

  test("❌ non-owner non-admin — returns 403", async () => {
    Payment.findById.mockResolvedValue(makePayment({
      user: { toString: () => "other-user" },
    }));

    const req = mockReq({
      params: { id: "payment-001" },
      user:   { id: "random-user", role: "user" },
    });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Not authorized" })
    );
  });

  test("❌ payment method is cash — returns 400", async () => {
    Payment.findById.mockResolvedValue(makePayment({ method: "cash" }));

    const req = mockReq({ params: { id: "payment-001" }, user: { id: "user-abc", role: "user" } });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "This payment is not QR method" })
    );
  });

  test("❌ payment not pending — returns 400", async () => {
    Payment.findById.mockResolvedValue(makePayment({ status: "completed" }));

    const req = mockReq({ params: { id: "payment-001" }, user: { id: "user-abc", role: "user" } });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "QR code is only available for pending payments",
      })
    );
  });

  test("❌ reservation not found — returns 404", async () => {
    Payment.findById.mockResolvedValue(makePayment());
    mockReservationFind(null);

    const req = mockReq({ params: { id: "payment-001" }, user: { id: "user-abc", role: "user" } });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Reservation or room not found" })
    );
  });

  test("❌ no active QR for coworking space — returns 404", async () => {
    Payment.findById.mockResolvedValue(makePayment());
    mockReservationFind(makeReservation());
    QrCode.findOne.mockResolvedValue(null);

    const req = mockReq({ params: { id: "payment-001" }, user: { id: "user-abc", role: "user" } });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "No active QR code found for this co-working space",
      })
    );
  });
});

// ─── getQrCodeBySpace ─────────────────────────────────────────────────────────

describe("getQrCodeBySpace controller", () => {

  test("✅ returns QR data URL with metadata for admin dashboard", async () => {
    const qrDoc = makeQrDoc({
      uploadedBy: { name: "Admin A" },
      createdAt:  new Date("2025-03-01"),
    });
    QrCode.findOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(qrDoc),
    });

    const req = mockReq({ params: { spaceId: "space-001" } });
    const res = mockRes();

    await getQrCodeBySpace(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          spaceId:    "space-001",
          qrCode:     expect.stringMatching(/^data:image\//),
          uploadedBy: "Admin A",
          uploadedAt: qrDoc.createdAt,
        }),
      })
    );
  });

  test("✅ queries with correct spaceId and isActive:true", async () => {
    const findOneMock = jest.fn().mockReturnValue({
      populate: jest.fn().mockResolvedValue(makeQrDoc({ uploadedBy: { name: "Admin" } })),
    });
    QrCode.findOne = findOneMock;

    const req = mockReq({ params: { spaceId: "space-xyz" } });
    const res = mockRes();

    await getQrCodeBySpace(req, res);

    expect(findOneMock).toHaveBeenCalledWith({
      coworkingSpace: "space-xyz",
      isActive: true,
    });
  });

  test("❌ no active QR for space — returns 404", async () => {
    QrCode.findOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(null),
    });

    const req = mockReq({ params: { spaceId: "space-001" } });
    const res = mockRes();

    await getQrCodeBySpace(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "No active QR code found for this co-working space",
      })
    );
  });

  test("❌ missing spaceId param — returns 400 'spaceId is required'", async () => {
    const req = mockReq({ params: {} });
    const res = mockRes();

    await getQrCodeBySpace(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "spaceId is required" })
    );
  });

  test("❌ DB error in getQrCodeBySpace — catch block returns 500", async () => {
    QrCode.findOne.mockReturnValue({
      populate: jest.fn().mockRejectedValue(new Error("DB error")),
    });

    const req = mockReq({ params: { spaceId: "space-001" } });
    const res = mockRes();

    await getQrCodeBySpace(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});

// ─── catch block coverage ─────────────────────────────────────────────────────

describe("getQrCode — catch block", () => {

  test("❌ DB error in getQrCode — catch block returns 500", async () => {
    Payment.findById.mockRejectedValue(new Error("DB connection lost"));

    const req = mockReq({ params: { id: "payment-001" }, user: { id: "user-abc", role: "user" } });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});
describe("uploadQrCode — handleError branches", () => {

  test("❌ CastError — returns 400 'Invalid ID format'", async () => {
    const err = new Error("bad id");
    err.name = "CastError";
    QrCode.findOneAndUpdate.mockRejectedValue(err);

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "image/png", buffer: Buffer.from("x"), originalname: "qr.png" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Invalid ID format" })
    );
  });

  test("❌ ValidationError — returns 400 with err.message", async () => {
    const err = new Error("field is required");
    err.name = "ValidationError";
    QrCode.findOneAndUpdate.mockRejectedValue(err);

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "image/png", buffer: Buffer.from("x"), originalname: "qr.png" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "field is required" })
    );
  });

  test("❌ generic error — returns 500 'Server error'", async () => {
    const err = new Error("Unexpected DB failure"); // name defaults to 'Error'
    QrCode.findOneAndUpdate.mockRejectedValue(err);

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "image/png", buffer: Buffer.from("x"), originalname: "qr.png" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Server error" })
    );
  });
});
test("✅ falls back to createdAt when updatedAt is absent", async () => {
  const createdAt = new Date("2025-06-01");
  QrCode.findOneAndUpdate.mockResolvedValue({
    updatedAt: null,   // falsy → triggers || branch ✅
    createdAt,
  });

  const req = mockReq({
    body: { spaceId: "space-001" },
    file: { mimetype: "image/png", buffer: Buffer.from("x"), originalname: "qr.png" },
  });
  const res = mockRes();

  await uploadQrCode(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ success: true, uploadedAt: createdAt })
  );
});