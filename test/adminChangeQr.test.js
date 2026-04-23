const { uploadQrCode, getQrCode } = require("../controllers/payments");

jest.mock("../models/QrCode");
const QrCode = require("../models/QrCode");

// ─── helpers ─────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status   = jest.fn().mockReturnValue(res);
  res.json     = jest.fn().mockReturnValue(res);
  res.send     = jest.fn().mockReturnValue(res); // getQrCode uses res.send
  res.set      = jest.fn().mockReturnValue(res); // getQrCode uses res.set
  return res;
};

const mockReq = (overrides = {}) => ({
  body:   {},
  query:  {},
  params: {},
  file:   null,
  user:   { id: "admin-user-id", name: "Admin", role: "admin" },
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

// ─── uploadQrCode ─────────────────────────────────────────────────────────────

describe("uploadQrCode controller", () => {

  test("✅ valid PNG — deactivates old, creates new, returns 201", async () => {
    QrCode.updateMany.mockResolvedValue({});
    QrCode.create.mockResolvedValue({ createdAt: new Date("2025-01-01") });

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "image/png", buffer: Buffer.from("fake-png"), originalname: "qr.png" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "QR Code updated successfully" })
    );
  });

  test("✅ valid JPG — returns 201", async () => {
    QrCode.updateMany.mockResolvedValue({});
    QrCode.create.mockResolvedValue({ createdAt: new Date() });

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "image/jpeg", buffer: Buffer.from("fake-jpg"), originalname: "qr.jpg" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  test("✅ valid WEBP — returns 201", async () => {
    QrCode.updateMany.mockResolvedValue({});
    QrCode.create.mockResolvedValue({ createdAt: new Date() });

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "image/webp", buffer: Buffer.from("fake-webp"), originalname: "qr.webp" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
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

  test("❌ invalid format — QrCode.updateMany throws 'Format Not Supported', returns 400", async () => {
    QrCode.updateMany.mockRejectedValue(new Error("Format Not Supported"));

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

  test("✅ replaces old QR — updateMany deactivates old, create sets new active", async () => {
    QrCode.updateMany.mockResolvedValue({ modifiedCount: 1 });
    const createdAt = new Date("2025-06-01");
    QrCode.create.mockResolvedValue({ createdAt });

    const req = mockReq({
      body: { spaceId: "space-001" },
      file: { mimetype: "image/png", buffer: Buffer.from("new-qr"), originalname: "new-qr.png" },
    });
    const res = mockRes();

    await uploadQrCode(req, res);

    expect(QrCode.updateMany).toHaveBeenCalledWith(
      { coworkingSpace: "space-001" },
      { isActive: false }
    );
    expect(QrCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkingSpace: "space-001",
        isActive:       true,
        uploadedBy:     "admin-user-id",
        mimeType:       "image/png",
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, uploadedAt: createdAt })
    );
  });
});

// ─── getQrCode ────────────────────────────────────────────────────────────────

describe("getQrCode controller", () => {

  test("✅ returns raw image buffer with correct Content-Type via query spaceId", async () => {
    const fakeBuffer = Buffer.from("fake-image-data");
    QrCode.findOne.mockResolvedValue({
      imageData: fakeBuffer.toString("base64"),
      mimeType:  "image/png",
    });

    // getQrCode reads req.params.coworkingId || req.query.spaceId
    const req = mockReq({ query: { spaceId: "space-001" } });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.set).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
    expect(res.json).not.toHaveBeenCalled();
  });

  test("✅ returns raw image buffer via params coworkingId", async () => {
    const fakeBuffer = Buffer.from("fake-image-data");
    QrCode.findOne.mockResolvedValue({
      imageData: fakeBuffer.toString("base64"),
      mimeType:  "image/jpeg",
    });

    const req = mockReq({ params: { coworkingId: "space-001" } });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.set).toHaveBeenCalledWith("Content-Type", "image/jpeg");
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });

  test("❌ no active QR for spaceId — returns 404", async () => {
    QrCode.findOne.mockResolvedValue(null);

    const req = mockReq({ query: { spaceId: "nonexistent-space" } });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "No active QR code found" })
    );
  });

  test("❌ missing spaceId and coworkingId — returns 400 'spaceId is required'", async () => {
    const req = mockReq({ query: {}, params: {} });
    const res = mockRes();

    await getQrCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "spaceId is required" })
    );
  });
});