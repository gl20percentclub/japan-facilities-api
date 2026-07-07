// ---------------------------------------------------------------------------
// データソース（出典）の master data。
//
// クロール対象のデータセットごとに、出典・ライセンス等のメタ情報を保持する。
// ここに 1 エントリ追加するだけで、新しい自治体のデータを 1 つのツリーに統合できる。
//
// 各エントリのフィールド:
//   resourceId    (必須) CKAN リソース ID。クロール対象。
//   municipality  自治体名（表示用）。例: '沖縄県'
//   datasetName   データセット名（表示用）。例: '食品営業許可・届出一覧'
//   sourceUrl     元データのページ URL（人が辿れる出典ページ）。
//   license       ライセンス名。例: 'CC BY 4.0' / 'Public Data License (PDL1.0)' / '自治体独自ライセンス'
//   licenseUrl    ライセンス条文の URL。
//
// これらは「curated（人が管理する確定値）」で、空欄にすると crawl.js が CKAN の
// メタデータ（package_show / resource_show）から自動補完する。curated 値がある
// 場合はそちらを優先する。取得日・自治体側の最終更新日・ダウンロード URL は
// クロール時に動的に付与される（config には持たない）。
// ---------------------------------------------------------------------------

export const DATASETS = [
  {
    resourceId: 'c9bf82c1-0689-4354-aada-c422f052be5e',
    municipality: '沖縄県',
    datasetName: '食品営業許可・届出一覧',
    sourceUrl: 'https://data.bodik.jp/dataset/okinawa-dpf_okinawa_pref',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.ja',
  },
  // 別の自治体データを追加する場合はここに resourceId 等を追記する。
];
