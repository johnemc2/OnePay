### Description

- Local, privacy-first OnePay statement parser that processes OnePay PDF statements entirely on your device and restores powerful filtering and CSV export directly in your browser that the native OnePay UI doesn’t provide. Drop in PDFs, filter by date/account/type/amount/description, and export results — no backend, no data leaves your machine.
- Based on [johnemc2/OnePay](https://github.com/johnemc2/OnePay)
  
### Key Features

- Advanced filtering by date, account, transaction type, amount, and free-text description.
- CSV export of filtered transactions with a date-stamped filename.
- Multi-statement processing (select multiple PDFs at once).
- Privacy-first: Parsing runs in your browser only; no data is sent anywhere.
- Resilient parsing for OnePay PDFs: dynamic column detection and nearest-neighbor clustering to handle split lines and layout shifts.

### How It Works

- Load one or more OnePay PDF statements.
- The app extracts transaction lines and normalizes columns (Date, Account, Description, Type, Amount).
- Use search and account filters to narrow results.
- Click Export CSV to save the current filtered view.

### Tech Stack

- JavaScript, HTML, CSS
- PDF.js (client-side PDF text extraction)
- No backend services or external data storage

### Why

- OnePay’s UI lacks filtering by several useful fields; this tool restores those capabilities and adds CSV export for analysis and bookkeeping, while keeping your data local.

### Statement Compatibility

- **Status:** This tool supports **all** formats from 2021 to present. The parser automatically detects the account type headers and adjusts accordingly.
- **NOTE:** Due to the change in naming conventions for some of the default accounts over the last few years (Debit/Checking/Spend), if importing statements from multiple years, it is recommended to consolodate accounts with the same account number to one name for better organization.

### Limitations

- Optimized for OnePay statement formats; major template changes may require parser updates.
- Heuristic parsing can occasionally need tuning for edge-case layouts.
- Currently, while it is possible to import multiple years worth of statements all at once, the date column does not include the year since the parser doesn't append the year from the statement period section of the PDFs. As such, it is recommended to only export statments from the same year and edit the CSV to append the year.
