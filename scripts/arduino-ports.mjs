import { SerialPort } from "serialport";

const ports = await SerialPort.list();
console.table(
  ports.map(({ path, manufacturer, serialNumber }) => ({
    path,
    manufacturer: manufacturer || "Unknown",
    serialNumber: serialNumber || "",
  })),
);
