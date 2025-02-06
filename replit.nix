{pkgs}: {
  deps = [
    pkgs.dig
    pkgs.inetutils
    pkgs.python311Packages.deep-translator
    pkgs.q-text-as-data
  ];
}
