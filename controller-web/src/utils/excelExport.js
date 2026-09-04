import * as XLSX from 'xlsx';

/**
 * Generates and downloads a multi-sheet Microsoft Excel (.xlsx) diagnostic report
 * for the target host machine.
 * 
 * @param {Object} reportData - Host diagnostics payload containing System, Disks, Processes, Network
 * @param {string} fallbackHostId - Fallback Hostname/ID if not in reportData
 */
export function exportHostDiagnosticsToExcel(reportData, fallbackHostId = 'TargetPC') {
  if (!reportData) {
    console.error('[Excel Export]: No report data provided.');
    return false;
  }

  const system = reportData.System || {};
  const disks = reportData.Disks || [];
  const processes = reportData.Processes || [];
  const network = reportData.Network || [];

  const hostname = system.Hostname || fallbackHostId || 'Remote-Host';
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `TargetPC_${hostname}_Report_${dateStr}.xlsx`;

  // Create a new Excel Workbook
  const workbook = XLSX.utils.book_new();

  // ----------------------------------------------------
  // SHEET 1: SYSTEM OVERVIEW
  // ----------------------------------------------------
  const systemOverviewRows = [
    { 'System Property': 'Machine Hostname', 'Details': hostname },
    { 'System Property': 'Company Workspace', 'Details': system.CompanyGroup || 'USPL' },
    { 'System Property': 'Operating System', 'Details': system.OSName || system.platform || 'Windows' },
    { 'System Property': 'OS Version / Build', 'Details': system.OSVersion || 'N/A' },
    { 'System Property': 'System Architecture', 'Details': system.Architecture || '64-bit' },
    { 'System Property': 'Hardware Manufacturer', 'Details': system.Manufacturer || 'Standard PC' },
    { 'System Property': 'Hardware Model', 'Details': system.Model || 'Standard System' },
    { 'System Property': 'Processor (CPU)', 'Details': system.CPU || 'Standard Processor' },
    { 'System Property': 'CPU Physical Cores', 'Details': system.CPUCores ? `${system.CPUCores} Cores` : 'N/A' },
    { 'System Property': 'CPU Logical Processors', 'Details': system.CPULogical ? `${system.CPULogical} Threads` : 'N/A' },
    { 'System Property': 'Total RAM Capacity', 'Details': system.TotalRAM_GB ? `${system.TotalRAM_GB} GB` : (system.ram || 'N/A') },
    { 'System Property': 'Free RAM Available', 'Details': system.FreeRAM_GB ? `${system.FreeRAM_GB} GB` : 'N/A' },
    { 'System Property': 'Used RAM Memory', 'Details': system.UsedRAM_GB ? `${system.UsedRAM_GB} GB` : 'N/A' },
    { 'System Property': 'RAM Memory Load', 'Details': system.RAMUsagePercent ? `${system.RAMUsagePercent}%` : 'N/A' },
    { 'System Property': 'Public WAN IP', 'Details': system.PublicIP || system.publicIp || 'N/A' },
    { 'System Property': 'Local LAN IP', 'Details': system.ip || (network[0]?.IPv4) || '127.0.0.1' },
    { 'System Property': 'Logged-in Domain & User', 'Details': system.LoggedUser || system.loggedUser || 'Admin' },
    { 'System Property': 'System Uptime', 'Details': system.Uptime || system.uptime || 'N/A' },
    { 'System Property': 'Last Reboot Timestamp', 'Details': system.LastBootTime || system.lastReboot || 'N/A' },
    { 'System Property': 'Report Generated At', 'Details': system.ExportedAt || now.toLocaleString() }
  ];

  const wsSystem = XLSX.utils.json_to_sheet(systemOverviewRows);
  wsSystem['!cols'] = [{ wch: 28 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(workbook, wsSystem, 'System Overview');

  // ----------------------------------------------------
  // SHEET 2: DISK PARTITIONS & STORAGE SPACE
  // ----------------------------------------------------
  const diskRows = disks.map(d => ({
    'Drive Letter': d.Drive || 'C:',
    'Volume Label': d.VolumeName || 'Local Disk',
    'File System': d.FileSystem || 'NTFS',
    'Total Space (GB)': d.TotalGB !== undefined ? d.TotalGB : 'N/A',
    'Free Space (GB)': d.FreeGB !== undefined ? d.FreeGB : 'N/A',
    'Used Space (GB)': d.UsedGB !== undefined ? d.UsedGB : 'N/A',
    'Usage (%)': d.UsagePercent !== undefined ? `${d.UsagePercent}%` : 'N/A',
    'Drive Type': d.DriveType || 'Local Fixed Disk',
    'Storage Status': (d.UsagePercent && d.UsagePercent > 90) ? '⚠️ Low Disk Space' : '✅ Healthy'
  }));

  const wsDisks = XLSX.utils.json_to_sheet(diskRows.length > 0 ? diskRows : [
    { 'Drive Letter': 'C:', 'Volume Label': 'Local Disk', 'File System': 'NTFS', 'Total Space (GB)': 'N/A', 'Free Space (GB)': 'N/A', 'Used Space (GB)': 'N/A', 'Usage (%)': 'N/A', 'Drive Type': 'Local Fixed Disk', 'Storage Status': 'N/A' }
  ]);
  wsDisks['!cols'] = [
    { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 18 },
    { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 20 }, { wch: 22 }
  ];
  XLSX.utils.book_append_sheet(workbook, wsDisks, 'Disk Partitions');

  // ----------------------------------------------------
  // SHEET 3: RUNNING PROCESSES
  // ----------------------------------------------------
  const processRows = processes.map(p => ({
    'Process Name': p.Name || 'Unknown',
    'Process ID (PID)': p.PID || 0,
    'Memory Working Set (MB)': p.MemoryMB !== undefined ? p.MemoryMB : 'N/A',
    'CPU Time (Sec)': p.CPUTimeSec !== undefined ? p.CPUTimeSec : 0,
    'Status': p.Responding || 'Running',
    'Executable File Path': p.Path || 'N/A'
  }));

  const wsProcesses = XLSX.utils.json_to_sheet(processRows.length > 0 ? processRows : [
    { 'Process Name': 'N/A', 'Process ID (PID)': 'N/A', 'Memory Working Set (MB)': 'N/A', 'CPU Time (Sec)': 'N/A', 'Status': 'N/A', 'Executable File Path': 'N/A' }
  ]);
  wsProcesses['!cols'] = [
    { wch: 30 }, { wch: 18 }, { wch: 26 }, { wch: 16 }, { wch: 18 }, { wch: 55 }
  ];
  XLSX.utils.book_append_sheet(workbook, wsProcesses, 'Running Processes');

  // ----------------------------------------------------
  // SHEET 4: NETWORK ADAPTERS
  // ----------------------------------------------------
  const networkRows = network.map(n => ({
    'Interface Name': n.Interface || 'Ethernet / Wi-Fi',
    'IPv4 Address': n.IPv4 || '127.0.0.1',
    'Subnet Prefix Length': n.PrefixLength ? `/${n.PrefixLength}` : 'N/A'
  }));

  const wsNetwork = XLSX.utils.json_to_sheet(networkRows.length > 0 ? networkRows : [
    { 'Interface Name': 'Network Adapter', 'IPv4 Address': system.ip || '127.0.0.1', 'Subnet Prefix Length': 'N/A' }
  ]);
  wsNetwork['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(workbook, wsNetwork, 'Network Adapters');

  // Trigger Excel File Download
  XLSX.writeFile(workbook, fileName);
  console.log(`[Excel Export]: Successfully generated and downloaded ${fileName}`);
  return true;
}
