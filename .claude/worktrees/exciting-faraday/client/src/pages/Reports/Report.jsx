import React from "react";
import { downloadCSV } from "../../utils/csvExport";

export default function Report() {
  const data = JSON.parse(localStorage.getItem("ops") || "[]");
  const rows = [["Title", "Amount"], ...data.map((r) => [r.title, r.amount])];

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4>Report</h4>
        <button
          className="btn btn-outline-primary"
          onClick={() => downloadCSV("report.csv", rows)}
        >
          Export CSV
        </button>
      </div>

      {data.length === 0 ? (
        <div className="alert alert-info">No data available</div>
      ) : (
        <div className="table-responsive">
          <table className="table table-striped">
            <thead><tr><th>Title</th><th>Amount</th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>{r.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
