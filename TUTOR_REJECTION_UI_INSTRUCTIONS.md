# Tutor rejection reason — Admin app & Tutor frontend

Backend behavior: when an admin **rejects** a tutor, they must send a **`rejectionReason`** string (1–2000 characters). That value is stored on the tutor and returned to the **tutor only** on **`GET /auth/me`** as `tutor.rejectionReason`. It is **not** exposed on public `GET /tutors` or `GET /tutors/:id`.

Replace `API_BASE` with your API URL (e.g. `https://api.example.com`). All admin calls require a JWT for a user with role **ADMIN** (`Authorization: Bearer <token>`).

---

## 1. Admin project

### Endpoint

`PATCH /admin/tutors/:tutorId/verify`

- **Path:** `tutorId` is the numeric **tutor** id (same id used in admin tutor list/detail), not the user id.
- **Headers:** `Authorization: Bearer <admin_access_token>`, `Content-Type: application/json`

### Request body

| Field | Type | Rules |
|--------|------|--------|
| `isApproved` | boolean | `true` = approve, `false` = reject |
| `rejectionReason` | string | **Required when `isApproved` is `false`.** Min length 1, max 2000 characters after trim. Omit or ignore when approving. |

**Approve (clears any previous rejection message on the server):**

```json
{
  "isApproved": true
}
```

**Reject (reason is mandatory):**

```json
{
  "isApproved": false,
  "rejectionReason": "Your certificate image was too blurry. Please upload a readable PDF or photo."
}
```

### Validation errors (400)

If the tutor rejects without a non-empty `rejectionReason`, the API responds with **400** and validation messages (e.g. `rejectionReason is required when rejecting a tutor`). Show these next to your form.

### UI recommendations

1. On your tutor review screen, add **two primary actions**: Approve / Reject.
2. **Reject flow:** open a modal or expand a section with a **required** multiline text field (“Reason for rejection”), `maxLength={2000}`, enforce non-empty before submit. Optional: show character count.
3. **Approve flow:** call the endpoint with only `{ "isApproved": true }` (no reason).
4. On success, refresh the tutor row or detail from `GET /admin/tutors` or `GET /admin/tutors/:id` — both include `rejectionReason` (`null` if approved or never rejected).

### Example (fetch)

```ts
async function verifyTutor(
  apiBase: string,
  token: string,
  tutorId: number,
  isApproved: boolean,
  rejectionReason?: string,
) {
  const body: { isApproved: boolean; rejectionReason?: string } = { isApproved };
  if (!isApproved) {
    body.rejectionReason = rejectionReason?.trim() ?? '';
  }
  const res = await fetch(`${apiBase}/admin/tutors/${tutorId}/verify`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? res.statusText);
  }
  return res.json();
}
```

---

## 2. Tutor frontend project

### Where the message appears

Use **`GET /auth/me`** after the tutor logs in (same endpoint you already use for profile). When `userType === "TUTOR"` and `tutor` is present:

- `tutor.isApproved` — `false` means not approved.
- `tutor.rejectionReason` — `string | null`. Non-null only when the admin last action was a rejection with a reason (or legacy data). After admin approves, backend sets this to **`null`**.

### When to show the message

Show a clear banner or card when:

```text
userType === 'TUTOR' && tutor && !tutor.isApproved && tutor.rejectionReason
```

Display `tutor.rejectionReason` as plain text (escape HTML if you render HTML). You can label it e.g. “Your application was not approved” / “Message from the team”.

If `!tutor.isApproved` but `rejectionReason` is null (e.g. still pending), show a generic “Under review” state instead of an empty rejection box.

### Example (TypeScript shape)

```ts
type MeResponse = {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  userType: 'LEARNER' | 'TUTOR' | 'ADMIN';
  createdAt: string;
  tutor?: {
    id: number;
    isApproved: boolean;
    rejectionReason: string | null;
    // ... other tutor fields
  };
};
```

### Do not rely on public tutor APIs for this

`GET /tutors` and `GET /tutors/:id` **do not** include `rejectionReason` (privacy). Tutors who are not approved also typically get **404** on public tutor-by-id; their feedback lives on **`/auth/me`** only.

---

## Quick checklist

| App | Task |
|-----|------|
| Admin | Reject → required textarea, `PATCH .../verify` with `isApproved: false` + `rejectionReason` |
| Admin | Approve → `PATCH` with `isApproved: true` only |
| Tutor app | After login / on profile, read `GET /auth/me` → show banner if `!isApproved && rejectionReason` |
