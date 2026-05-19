import React, { useState } from "react";

export default function Task() {
  const [form, setForm] = useState({ title: "", amount: "" });
  const [list, setList] = useState(() => JSON.parse(localStorage.getItem("ops") || "[]"));

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.title || !form.amount) return;

    const next = [...list, { id: Date.now(), ...form }];
    setList(next);
    localStorage.setItem("ops", JSON.stringify(next));
    setForm({ title: "", amount: "" });
  }

  function remove(id) {
    const next = list.filter((x) => x.id !== id);
    setList(next);
    localStorage.setItem("ops", JSON.stringify(next));
  }
  

  return (
    <div className="container-fluid py-4">
      <div className="row">
        <div className="col-md-5 mb-3">
          <div className="card">
            <div className="card-body">
              <h5>New Operation</h5>
              <form onSubmit={handleSubmit}>
                <div className="mb-2">
                  <label className="form-label">Title</label>
                  <input
                    className="form-control"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label">Amount</label>
                  <input
                    type="number"
                    className="form-control"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </div>
                <button className="btn btn-primary" >Save</button>
              </form>
            </div>
          </div>
        </div>

        <div className="col-md-7">
          <div className="card">
            <div className="card-body">
              <h5>Operation List</h5>
              <table className="table">
                <thead><tr><th>Title</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <td>{r.title}</td>
                      <td>{r.amount}</td>
                      <td>
                        <button className="btn btn-sm btn-danger" onClick={() => remove(r.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
