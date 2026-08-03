use std::collections::HashSet;

#[derive(serde::Serialize, Default)]
pub struct SystemInfo {
    pub hostname: String,
    pub uptime_sec: u64,
    pub os: String,
    pub arch: String,
}

#[derive(serde::Serialize, Default)]
pub struct LoadInfo {
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
}

#[derive(serde::Serialize, Default)]
pub struct CpuInfo {
    pub model: String,
    pub cores: u32,
    pub usage: f64,
    pub per_core: Vec<f64>,
}

#[derive(serde::Serialize, Default)]
pub struct MemoryInfo {
    pub used: u64,
    pub available: u64,
    pub cached: u64,
}

#[derive(serde::Serialize)]
pub struct NetworkInfo {
    pub nic: String,
    pub state: String,
    pub rx_bytes_per_sec: f64,
    pub tx_bytes_per_sec: f64,
}

#[derive(serde::Serialize, Default)]
pub struct NetworkSummaryInfo {
    pub rx_bytes_per_sec: f64,
    pub tx_bytes_per_sec: f64,
}

#[derive(serde::Serialize)]
pub struct DiskInfo {
    pub device: String,
    pub mount: String,
    pub total: u64,
    pub available: u64,
    pub use_percent: u32,
}

#[derive(serde::Serialize, Default)]
pub struct RemoteStats {
    pub system: SystemInfo,
    pub load: LoadInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub networks: Vec<NetworkInfo>,
    pub network_summary: NetworkSummaryInfo,
    pub disks: Vec<DiskInfo>,
}

pub const SYSINFO_SCRIPT: &str = r#"sh -c '
base=${TMPDIR:-/tmp}/sysinfo.$$;
hostf=$base.host;
archf=$base.arch;
cpu1=$base.cpu1;
cpu2=$base.cpu2;
cpucoref=$base.cpucores;
net1=$base.net1;
net2=$base.net2;
netr=$base.netr;
diskf=$base.disk;
diskraw=$base.diskraw;
dfraw=$base.dfraw;

trap "rm -f \"$base\".*" 0 HUP INT TERM;

run_limited() {
  run_out=$1;
  run_seconds=$2;
  shift 2;
  run_tmp=$run_out.tmp;

  rm -f "$run_out" "$run_tmp";

  (
    "$@" >"$run_tmp" 2>/dev/null
  ) &
  run_pid=$!;

  (
    sleep "$run_seconds" 2>/dev/null || sleep 1;
    kill "$run_pid" 2>/dev/null;
    sleep 1;
    kill -9 "$run_pid" 2>/dev/null;
  ) &
  run_watch=$!;

  wait "$run_pid" 2>/dev/null;
  run_status=$?;

  kill "$run_watch" 2>/dev/null;
  wait "$run_watch" 2>/dev/null;

  if [ "$run_status" -eq 0 ]; then
    mv "$run_tmp" "$run_out" 2>/dev/null || return 1;
    return 0;
  fi;

  rm -f "$run_tmp";
  : >"$run_out";
  return 1;
}

host=unknown;
if [ -r /proc/sys/kernel/hostname ]; then
  IFS= read -r host </proc/sys/kernel/hostname || host=unknown;
fi;

if [ -z "$host" ] || [ "$host" = "unknown" ]; then
  if run_limited "$hostf" 1 uname -n && [ -s "$hostf" ]; then
    IFS= read -r host <"$hostf" || host=unknown;
  fi;
fi;

[ -n "$host" ] || host=unknown;
host=$(printf "%s" "$host" | tr "\t\r\n" "   ");

uptime_sec=0;
if [ -r /proc/uptime ]; then
  read upraw _ </proc/uptime || upraw=0;
  uptime_sec=${upraw%.*};
fi;
[ -n "$uptime_sec" ] || uptime_sec=0;

os=unknown;
if [ -r /etc/os-release ]; then
  . /etc/os-release;
  os=${PRETTY_NAME:-unknown};
else
  if run_limited "$hostf" 1 uname -s && [ -s "$hostf" ]; then
    IFS= read -r os <"$hostf" || os=unknown;
  fi;
fi;
[ -n "$os" ] || os=unknown;
os=$(printf "%s" "$os" | tr "\t\r\n" "   ");

arch=unknown;
if run_limited "$archf" 1 uname -m && [ -s "$archf" ]; then
  IFS= read -r arch <"$archf" || arch=unknown;
fi;
[ -n "$arch" ] || arch=unknown;

l1=0;
l5=0;
l15=0;
if [ -r /proc/loadavg ]; then
  read l1 l5 l15 _ </proc/loadavg || {
    l1=0;
    l5=0;
    l15=0;
  };
fi;

cpu_model=$(awk -F: '"'"'
/^(model name|Hardware|Processor|cpu model)[[:space:]]*:/ && !m {
  gsub(/^[ \t]+/, "", $2);
  m=$2;
}
END {
  if (!m) m="unknown";
  print m;
}
'"'"' /proc/cpuinfo 2>/dev/null);

cpu_model=$(printf "%s" "$cpu_model" | tr "\t\r\n" "   ");
[ -n "$cpu_model" ] || cpu_model=unknown;

cpu_cores=$(awk '"'"'
/^processor[[:space:]]*:/ { c++ }
END { print c+0 }
'"'"' /proc/cpuinfo 2>/dev/null);

case $cpu_cores in
  ""|0)
    if run_limited "$cpucoref" 1 getconf _NPROCESSORS_ONLN && [ -s "$cpucoref" ]; then
      IFS= read -r cpu_cores <"$cpucoref" || cpu_cores=0;
    fi;
    ;;
esac;
[ -n "$cpu_cores" ] || cpu_cores=0;

awk '"'"'
/^cpu/ {
  idle=$5+$6;
  total=0;
  for (i=2; i<=NF; i++) total+=$i;
  print $1, idle, total;
}
'"'"' /proc/stat >"$cpu1" 2>/dev/null || : >"$cpu1";

awk '"'"'
NR>2 {
  line=$0;
  sub(/^[ \t]+/, "", line);
  split(line, a, ":");
  nic=a[1];
  gsub(/^[ \t]+|[ \t]+$/, "", nic);
  gsub(/^[ \t]+/, "", a[2]);
  split(a[2], f, /[ \t]+/);
  print nic "\t" f[1] "\t" f[9];
}
'"'"' /proc/net/dev >"$net1" 2>/dev/null || : >"$net1";

interval=0.2;
sleep "$interval" 2>/dev/null || {
  interval=1;
  sleep 1;
};

awk '"'"'
/^cpu/ {
  idle=$5+$6;
  total=0;
  for (i=2; i<=NF; i++) total+=$i;
  print $1, idle, total;
}
'"'"' /proc/stat >"$cpu2" 2>/dev/null || : >"$cpu2";

awk '"'"'
NR>2 {
  line=$0;
  sub(/^[ \t]+/, "", line);
  split(line, a, ":");
  nic=a[1];
  gsub(/^[ \t]+|[ \t]+$/, "", nic);
  gsub(/^[ \t]+/, "", a[2]);
  split(a[2], f, /[ \t]+/);
  print nic "\t" f[1] "\t" f[9];
}
'"'"' /proc/net/dev >"$net2" 2>/dev/null || : >"$net2";

cpu_usage=$(awk '"'"'
NR==FNR {
  id[$1]=$2;
  tot[$1]=$3;
  next;
}
$1=="cpu" {
  didle=$2-id[$1];
  dtotal=$3-tot[$1];
  cpu=(dtotal>0) ? (1-didle/dtotal)*100 : 0;
  printf "%.1f", cpu;
}
'"'"' "$cpu1" "$cpu2" 2>/dev/null);
[ -n "$cpu_usage" ] || cpu_usage=0;

set -- $(awk '"'"'
/MemTotal:/ { t=$2 }
/MemAvailable:/ { a=$2 }
/Buffers:/ { b=$2 }
/^Cached:/ { c=$2 }
/SReclaimable:/ { s=$2 }
END {
  if (!t) t=0;
  if (!a) a=0;
  if (!b) b=0;
  if (!c) c=0;
  if (!s) s=0;
  printf "%.0f %.0f %.0f\n", (t-a)*1024, a*1024, (b+c+s)*1024;
}
'"'"' /proc/meminfo 2>/dev/null);

mem_used=${1:-0};
mem_avail=${2:-0};
mem_cache=${3:-0};

printf "SYSTEM\t%s\t%s\t%s\t%s\n" "$host" "$uptime_sec" "$os" "$arch";
printf "LOAD\t%s\t%s\t%s\n" "$l1" "$l5" "$l15";
printf "CPU\t%s\t%s\t%s\n" "$cpu_model" "$cpu_cores" "$cpu_usage";

awk '"'"'
NR==FNR {
  id[$1]=$2;
  tot[$1]=$3;
  next;
}
/^cpu[0-9]/ {
  didle=$2-id[$1];
  dtotal=$3-tot[$1];
  cpu=(dtotal>0) ? (1-didle/dtotal)*100 : 0;
  n=substr($1,4);
  printf "CPUCORE\t%s\t%.1f\n", n, cpu;
}
'"'"' "$cpu1" "$cpu2" 2>/dev/null;

printf "MEMORY\t%s\t%s\t%s\n" "$mem_used" "$mem_avail" "$mem_cache";

awk -v s="$interval" '"'"'
BEGIN {
  OFS="\t";
}
FNR==NR {
  rx[$1]=$2;
  tx[$1]=$3;
  next;
}
{
  nic=$1;

  if (nic=="" || nic=="lo") next;
  if (nic ~ /^(docker|veth|br-|virbr|flannel|cali|tunl|kube-ipvs0|cni|zt|tailscale|wg|tap|vnet)/) next;

  rxv=($2-rx[nic])/s;
  txv=($3-tx[nic])/s;

  if (rxv<0) rxv=0;
  if (txv<0) txv=0;

  printf "%s\t%.0f\t%.0f\n", nic, rxv, txv;
}
'"'"' "$net1" "$net2" >"$netr" 2>/dev/null || : >"$netr";

found_net=0;

if [ -s "$netr" ]; then
  while IFS="$(printf "\t")" read -r nic rx tx; do
    [ -n "$nic" ] || continue;
    [ -e "/sys/class/net/$nic/device" ] || continue;

    state=unknown;
    if [ -r "/sys/class/net/$nic/operstate" ]; then
      IFS= read -r state <"/sys/class/net/$nic/operstate" || state=unknown;
    fi;
    [ "$state" = "up" ] || continue;

    printf "NETWORK\t%s\t%s\t%s\t%s\n" "$nic" "$state" "$rx" "$tx";
    found_net=1;
  done <"$netr";
fi;

[ "$found_net" -eq 1 ] || printf "NETWORK\t-\t-\t0\t0\n";

: >"$diskf";

if command -v findmnt >/dev/null 2>&1; then
  if run_limited "$diskraw" 2 findmnt -b -rn -o SOURCE,TARGET,FSTYPE,SIZE,AVAIL,USE%; then
    awk '"'"'
  BEGIN {
    OFS="\t";
  }
  {
    src=$1;
    mp=$2;
    fstype=$3;
    total=$4;
    avail=$5;
    usep=$6;

    if (src !~ "^/dev/") next;
    if (mp=="" || mp=="-") next;
    if (seen[mp]++) next;

    if (fstype ~ /^(tmpfs|devtmpfs|squashfs|overlay|proc|sysfs|cgroup|cgroup2|devpts|securityfs|pstore|bpf|tracefs|debugfs|mqueue|hugetlbfs|fusectl|configfs|autofs|ramfs|binfmt_misc)$/) next;

    gsub(/%/, "", usep);

    printf "%s\t%s\t%s\t%s\t%s\n", src, mp, total, avail, usep;
  }
  '"'"' "$diskraw" >"$diskf" 2>/dev/null || : >"$diskf";
  fi;
fi;

if [ ! -s "$diskf" ] && command -v df >/dev/null 2>&1; then
  if run_limited "$dfraw" 2 df -B1 -P; then
    awk '"'"'
  BEGIN {
    OFS="\t";
  }
  NR>1 {
    src=$1;
    total=$2;
    avail=$4;
    usep=$5;
    mp=$6;

    if (src !~ "^/dev/") next;
    if (mp=="" || mp=="-") next;
    if (seen[mp]++) next;

    gsub(/%/, "", usep);

    printf "%s\t%s\t%s\t%s\t%s\n", src, mp, total, avail, usep;
  }
  '"'"' "$dfraw" >"$diskf" 2>/dev/null || : >"$diskf";
  fi;
fi;

if [ -s "$diskf" ]; then
  while IFS="$(printf "\t")" read -r disk mp total avail usep; do
    [ -n "$disk" ] || continue;
    printf "DISK\t%s\t%s\t%s\t%s\t%s\n" "$disk" "$mp" "$total" "$avail" "$usep";
  done <"$diskf";
else
  printf "DISK\t-\t-\t0\t0\t0\n";
fi
'"#;

pub fn parse_stats_output(output: &str) -> RemoteStats {
    let mut stats = RemoteStats::default();
    let mut seen_disk_mounts = HashSet::new();

    for line in output.lines() {
        let cols: Vec<&str> = line.split('\t').collect();

        if cols.is_empty() {
            continue;
        }

        match cols[0] {
            "SYSTEM" if cols.len() >= 5 => {
                stats.system = SystemInfo {
                    hostname: cols[1].to_string(),
                    uptime_sec: cols[2].parse().unwrap_or(0),
                    os: cols[3].to_string(),
                    arch: cols[4].to_string(),
                };
            }

            "LOAD" if cols.len() >= 4 => {
                stats.load = LoadInfo {
                    load1: cols[1].parse().unwrap_or(0.0),
                    load5: cols[2].parse().unwrap_or(0.0),
                    load15: cols[3].parse().unwrap_or(0.0),
                };
            }

            "CPU" if cols.len() >= 4 => {
                stats.cpu = CpuInfo {
                    model: cols[1].to_string(),
                    cores: cols[2].parse().unwrap_or(0),
                    usage: cols[3].parse().unwrap_or(0.0),
                    per_core: Vec::new(),
                };
            }

            "CPUCORE" if cols.len() >= 3 => {
                let usage: f64 = cols[2].parse().unwrap_or(0.0);
                stats.cpu.per_core.push(usage);
            }

            "MEMORY" if cols.len() >= 4 => {
                stats.memory = MemoryInfo {
                    used: cols[1].parse().unwrap_or(0),
                    available: cols[2].parse().unwrap_or(0),
                    cached: cols[3].parse().unwrap_or(0),
                };
            }

            "NETWORK" if cols.len() >= 5 => {
                if cols[1] != "-" {
                    stats.networks.push(NetworkInfo {
                        nic: cols[1].to_string(),
                        state: cols[2].to_string(),
                        rx_bytes_per_sec: cols[3].parse().unwrap_or(0.0),
                        tx_bytes_per_sec: cols[4].parse().unwrap_or(0.0),
                    });
                }
            }

            "DISK" if cols.len() >= 6 => {
                if cols[1] != "-" {
                    let mount = cols[2].trim();

                    if mount.is_empty() || mount == "-" {
                        continue;
                    }

                    if seen_disk_mounts.insert(mount.to_string()) {
                        stats.disks.push(DiskInfo {
                            device: cols[1].to_string(),
                            mount: mount.to_string(),
                            total: cols[3].parse().unwrap_or(0),
                            available: cols[4].parse().unwrap_or(0),
                            use_percent: cols[5].parse().unwrap_or(0),
                        });
                    }
                }
            }

            _ => {}
        }
    }

    stats.network_summary = NetworkSummaryInfo {
        rx_bytes_per_sec: stats.networks.iter().map(|net| net.rx_bytes_per_sec).sum(),
        tx_bytes_per_sec: stats.networks.iter().map(|net| net.tx_bytes_per_sec).sum(),
    };

    stats
}

#[cfg(test)]
mod tests {
    use super::parse_stats_output;

    #[test]
    fn parse_stats_output_parses_complete_snapshot() {
        let stats = parse_stats_output(
            "SYSTEM\tnode-1\t12345\tUbuntu 24.04\tx86_64\n\
             LOAD\t0.10\t0.20\t0.30\n\
             CPU\tAMD Ryzen\t8\t12.5\n\
             CPUCORE\t0\t10.0\n\
             CPUCORE\t1\t15.0\n\
             MEMORY\t1000\t3000\t500\n\
             NETWORK\teth0\tup\t100\t200\n\
             NETWORK\twlan0\tup\t50\t25\n\
             DISK\t/dev/sda1\t/\t10000\t4000\t60\n",
        );

        assert_eq!(stats.system.hostname, "node-1");
        assert_eq!(stats.system.uptime_sec, 12345);
        assert_eq!(stats.system.os, "Ubuntu 24.04");
        assert_eq!(stats.system.arch, "x86_64");
        assert_eq!(stats.load.load1, 0.10);
        assert_eq!(stats.cpu.model, "AMD Ryzen");
        assert_eq!(stats.cpu.cores, 8);
        assert_eq!(stats.cpu.usage, 12.5);
        assert_eq!(stats.cpu.per_core, vec![10.0, 15.0]);
        assert_eq!(stats.memory.used, 1000);
        assert_eq!(stats.memory.available, 3000);
        assert_eq!(stats.memory.cached, 500);
        assert_eq!(stats.networks.len(), 2);
        assert_eq!(stats.network_summary.rx_bytes_per_sec, 150.0);
        assert_eq!(stats.network_summary.tx_bytes_per_sec, 225.0);
        assert_eq!(stats.disks.len(), 1);
        assert_eq!(stats.disks[0].mount, "/");
        assert_eq!(stats.disks[0].available, 4000);
    }

    #[test]
    fn parse_stats_output_keeps_partial_snapshot_without_disks() {
        let without_disk = parse_stats_output(
            "SYSTEM\tnode-1\t12345\tUbuntu 24.04\tx86_64\n\
             LOAD\t0.10\t0.20\t0.30\n\
             CPU\tAMD Ryzen\t8\t12.5\n\
             MEMORY\t1000\t3000\t500\n\
             NETWORK\teth0\tup\t100\t200\n",
        );

        assert_eq!(without_disk.cpu.usage, 12.5);
        assert_eq!(without_disk.memory.available, 3000);
        assert_eq!(without_disk.network_summary.rx_bytes_per_sec, 100.0);
        assert!(without_disk.disks.is_empty());

        let placeholder_disk = parse_stats_output(
            "SYSTEM\tnode-1\t12345\tUbuntu 24.04\tx86_64\n\
             LOAD\t0.10\t0.20\t0.30\n\
             CPU\tAMD Ryzen\t8\t12.5\n\
             MEMORY\t1000\t3000\t500\n\
             NETWORK\teth0\tup\t100\t200\n\
             DISK\t-\t-\t0\t0\t0\n",
        );

        assert_eq!(placeholder_disk.cpu.usage, 12.5);
        assert_eq!(placeholder_disk.network_summary.tx_bytes_per_sec, 200.0);
        assert!(placeholder_disk.disks.is_empty());
    }

    #[test]
    fn parse_stats_output_deduplicates_disk_mounts() {
        let stats = parse_stats_output(
            "DISK\t/dev/sda1\t/\t10000\t4000\t60\n\
             DISK\t/dev/disk/by-uuid/root\t/\t10000\t3000\t70\n\
             DISK\t/dev/sdb1\t/data\t20000\t15000\t25\n",
        );

        assert_eq!(stats.disks.len(), 2);
        assert_eq!(stats.disks[0].device, "/dev/sda1");
        assert_eq!(stats.disks[0].mount, "/");
        assert_eq!(stats.disks[1].mount, "/data");
    }
}
