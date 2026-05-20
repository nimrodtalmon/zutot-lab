import { useState } from "react";
import { startAuthFlow } from "../drive/auth";
import { pickFolder } from "../drive/picker";
import type { DriveToken } from "../types";

interface Props {
  hasToken: boolean;
  hasFolder: boolean;
  hasStudent: boolean;
  token: DriveToken | null;
  onFolderPicked: (id: string, name: string) => void;
  onStudentSet: (uuid: string) => void;
}

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function Wizard({
  hasToken,
  hasFolder,
  hasStudent,
  token,
  onFolderPicked,
  onStudentSet,
}: Props) {
  const [pickerErr, setPickerErr] = useState<string | null>(null);
  const [studentInput, setStudentInput] = useState("");
  const [studentErr, setStudentErr] = useState<string | null>(null);

  const step = !hasToken ? 1 : !hasFolder ? 2 : !hasStudent ? 3 : 4;

  async function onPickFolder() {
    setPickerErr(null);
    if (!token) return;
    try {
      const f = await pickFolder(token);
      if (f) onFolderPicked(f.id, f.name);
    } catch (e: any) {
      setPickerErr(e?.message ?? "Picker failed");
    }
  }

  function onSubmitStudent(e: React.FormEvent) {
    e.preventDefault();
    const m = studentInput.match(UUID_RE);
    if (!m) {
      setStudentErr("Need a UUID like 12345678-1234-1234-1234-1234567890ab.");
      return;
    }
    onStudentSet(m[0]);
  }

  function classFor(n: number) {
    if (step > n) return "step done";
    if (step === n) return "step active";
    return "step";
  }

  return (
    <div className="wizard">
      <h1>Zutot Observer</h1>
      <p className="lead">A read-only lens over your zutot-lab-os Drive folder. Three quick steps.</p>

      <div className={classFor(1)}>
        <div className="num">1</div>
        <div className="body">
          <h2>Connect Google Drive</h2>
          <p>Read-only access. We never write to Drive.</p>
          {step === 1 && (
            <button className="btn primary" onClick={() => startAuthFlow()}>
              Connect Drive
            </button>
          )}
        </div>
      </div>

      <div className={classFor(2)}>
        <div className="num">2</div>
        <div className="body">
          <h2>Pick the lab folder</h2>
          <p>Choose the folder named <code>zutot-lab-os</code> in Drive.</p>
          {step === 2 && (
            <>
              <button className="btn primary" onClick={onPickFolder}>
                Pick folder
              </button>
              {pickerErr && <div className="error">{pickerErr}</div>}
            </>
          )}
        </div>
      </div>

      <div className={classFor(3)}>
        <div className="num">3</div>
        <div className="body">
          <h2>Paste Student project URL</h2>
          <p>
            From claude.ai — looks like <code>https://claude.ai/project/&lt;uuid&gt;…</code>
          </p>
          {step === 3 && (
            <form onSubmit={onSubmitStudent}>
              <input
                type="text"
                placeholder="https://claude.ai/project/…"
                value={studentInput}
                onChange={(e) => {
                  setStudentInput(e.target.value);
                  setStudentErr(null);
                }}
              />
              <div className="row">
                <button
                  type="submit"
                  className="btn primary"
                  disabled={!UUID_RE.test(studentInput)}
                >
                  Save
                </button>
              </div>
              {studentErr && <div className="error">{studentErr}</div>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
