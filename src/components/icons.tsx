import type { IconType } from "react-icons";
import {
  SiAmazonwebservices,
  SiApple,
  SiCentos,
  SiDebian,
  SiDocker,
  SiFedora,
  SiGithub,
  SiGitlab,
  SiGo,
  SiGooglecloud,
  SiJavascript,
  SiKubernetes,
  SiLinux,
  SiMongodb,
  SiMysql,
  SiNginx,
  SiNodedotjs,
  SiPhp,
  SiPostgresql,
  SiPython,
  SiRedis,
  SiRust,
  SiTypescript,
  SiUbuntu,
  SiGoogle,
  SiBaidu,
  SiDuckduckgo,
  SiBilibili,
  SiOpenai,
  SiClaude,
  SiGooglegemini,
  SiZhihu,
  SiYoutube,
  SiAndroid,
  SiArchlinux,
  SiManjaro,
  SiOpensuse,
  SiFreebsd,
  SiRaspberrypi,
  SiRockylinux,
  SiAlmalinux,
  SiNixos,
  SiGentoo,
  SiAlpinelinux,
  SiKalilinux,
  SiLinuxmint,
} from "react-icons/si";
import { FaWindows } from "react-icons/fa";
import { DiBingSmall, DiYahooSmall } from "react-icons/di";
import { MdSearch } from "react-icons/md";

export interface QuickIconDef {
  icon: IconType;
  color: string;
}

export const QUICK_ICONS: Record<string, QuickIconDef> = {
  docker: { icon: SiDocker, color: "#2496ed" },
  k8s: { icon: SiKubernetes, color: "#326ce5" },
  linux: { icon: SiLinux, color: "#FCC624" },
  ubuntu: { icon: SiUbuntu, color: "#E95420" },
  debian: { icon: SiDebian, color: "#A81D33" },
  centos: { icon: SiCentos, color: "#262577" },
  fedora: { icon: SiFedora, color: "#3C4FB1" },
  apple: { icon: SiApple, color: "#A2AAAD" },
  github: { icon: SiGithub, color: "#181717" },
  gitlab: { icon: SiGitlab, color: "#FC6D26" },
  nginx: { icon: SiNginx, color: "#009639" },
  redis: { icon: SiRedis, color: "#DC382D" },
  postgres: { icon: SiPostgresql, color: "#4169E1" },
  mysql: { icon: SiMysql, color: "#4479A1" },
  mongodb: { icon: SiMongodb, color: "#47A248" },
  python: { icon: SiPython, color: "#3776AB" },
  js: { icon: SiJavascript, color: "#F7DF1E" },
  ts: { icon: SiTypescript, color: "#3178C6" },
  rust: { icon: SiRust, color: "#000000" },
  go: { icon: SiGo, color: "#00ADD8" },
  node: { icon: SiNodedotjs, color: "#339933" },
  php: { icon: SiPhp, color: "#777BB4" },
  aws: { icon: SiAmazonwebservices, color: "#232F3E" },
  gcp: { icon: SiGooglecloud, color: "#4285F4" },
};

export type QuickIconName = keyof typeof QUICK_ICONS;

/** Mainstream OS / distro icons. */
export const SYSTEM_ICONS: Record<string, QuickIconDef> = {
  windows: { icon: FaWindows, color: "#0078D4" },
  apple: { icon: SiApple, color: "#A2AAAD" },
  android: { icon: SiAndroid, color: "#3DDC84" },
  linux: { icon: SiLinux, color: "#FCC624" },
  ubuntu: { icon: SiUbuntu, color: "#E95420" },
  debian: { icon: SiDebian, color: "#A81D33" },
  centos: { icon: SiCentos, color: "#262577" },
  fedora: { icon: SiFedora, color: "#3C4FB1" },
  arch: { icon: SiArchlinux, color: "#1793D1" },
  manjaro: { icon: SiManjaro, color: "#35BF5C" },
  opensuse: { icon: SiOpensuse, color: "#73BA25" },
  rocky: { icon: SiRockylinux, color: "#10B981" },
  alma: { icon: SiAlmalinux, color: "#FF4649" },
  alpine: { icon: SiAlpinelinux, color: "#0D597F" },
  kali: { icon: SiKalilinux, color: "#268BEE" },
  mint: { icon: SiLinuxmint, color: "#87CF3E" },
  nixos: { icon: SiNixos, color: "#5277C3" },
  gentoo: { icon: SiGentoo, color: "#54487A" },
  freebsd: { icon: SiFreebsd, color: "#AB2B28" },
  raspberrypi: { icon: SiRaspberrypi, color: "#A22846" },
};

export type SystemIconName = keyof typeof SYSTEM_ICONS;

/** Merged lookup for all connection icons (services + systems). */
export const CONNECTION_ICONS: Record<string, QuickIconDef> = {
  ...QUICK_ICONS,
  ...SYSTEM_ICONS,
};

export const SEARCH_ICONS: Record<string, QuickIconDef> = {
  google: { icon: SiGoogle, color: "#4285F4" },
  duckduckgo: { icon: SiDuckduckgo, color: "#DE5833" },
  baidu: { icon: SiBaidu, color: "#2932E1" },
  bilibili: { icon: SiBilibili, color: "#00A1D6" },
  zhihu: { icon: SiZhihu, color: "#0084FF" },
  youtube: { icon: SiYoutube, color: "#FF0000" },
  github: { icon: SiGithub, color: "#181717" },
  gitlab: { icon: SiGitlab, color: "#FC6D26" },
  bing: { icon: DiBingSmall, color: "#008373" },
  yahoo: { icon: DiYahooSmall, color: "#410093" },
  openai: { icon: SiOpenai, color: "#10A37F" },
  claude: { icon: SiClaude, color: "#d97757" },
  gemini: { icon: SiGooglegemini, color: "#4285F4" },
  default: { icon: MdSearch, color: "currentColor" },
};

export type SearchIconName = keyof typeof SEARCH_ICONS;
