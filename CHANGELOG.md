# Changelog

## [0.5.0](https://github.com/wannli/fileclass-inline/compare/0.4.0...0.5.0) (2026-10-14)


### Added

* **main:** integrate Fileclass backend ([7c6fb61](https://github.com/wannli/fileclass-inline/commit/7c6fb61e6f8c15fddf887eacada26132b3a9689a))
* **main:** reconcile Fileclass integration ([d1d0230](https://github.com/wannli/fileclass-inline/commit/d1d0230c0085df2b754404f0b8f177e888532c74))
* **main:** remove colored highlights ([bb37ca1](https://github.com/wannli/fileclass-inline/commit/bb37ca16fac8acb5d3a7a8f141123a8ae67c3521))
* **ui:** add capture folder picker ([16dd0f6](https://github.com/wannli/fileclass-inline/commit/16dd0f6e6b58f70d2be628ee495738a1aa4eeeca))

## [0.4.0](https://github.com/wannli/obsidian-nodes/compare/0.3.1...0.4.0) (2026-10-14)


### Added

* **main:** rename plugin to FileClass Inline ([4ad8984](https://github.com/wannli/obsidian-nodes/commit/4ad8984c68fd43ac80fa9b9d29ddeef6d9614de7))

## [0.3.1](https://github.com/wannli/obsidian-nodes/compare/0.3.0...0.3.1) (2026-10-12)


### Fixed

* **api:** reuse node cleanup for linked creation ([48cd967](https://github.com/wannli/obsidian-nodes/commit/48cd9676615ea0eb2908aef48679a2836a1d0bcf))

## [0.3.0](https://github.com/wannli/obsidian-nodes/compare/0.2.0...0.3.0) (2026-10-12)


### Added

* **main:** expose schema-aware node integration api ([939f07f](https://github.com/wannli/obsidian-nodes/commit/939f07f31d3cd8521ceac935e129f0186b00d804))

## [0.2.0](https://github.com/wannli/obsidian-nodes/compare/0.1.0...0.2.0) (2026-10-11)


### Added

* **main:** create typed nodes from selected text ([76fc7e8](https://github.com/wannli/obsidian-nodes/commit/76fc7e8b85190431404a3d8853aff40909697682))
* **main:** guard link insertion against stale editor state ([2082cbd](https://github.com/wannli/obsidian-nodes/commit/2082cbdb9f72f6c95814a63fad5a0de7898f1869))
* **main:** highlight completed links by node type ([11134a4](https://github.com/wannli/obsidian-nodes/commit/11134a4f9a62d4b39e36ddf01dda5ebd06584e8a))
* **main:** index typed nodes and fuzzy-match aliases ([b69943c](https://github.com/wannli/obsidian-nodes/commit/b69943ce46fc70a3489b3df5b6195f6878ec6a78))
* **main:** record schema number in new nodes ([3430b33](https://github.com/wannli/obsidian-nodes/commit/3430b3316c181ace5b197ee03a68777002002e9c))
* **main:** track inferable link-created node content ([2a73ddb](https://github.com/wannli/obsidian-nodes/commit/2a73ddb4b547e25f6288cbad07b977445a8ecfa1))
* **main:** trash pristine nodes after their last link disappears ([0debbe9](https://github.com/wannli/obsidian-nodes/commit/0debbe92a9bf78e48a72bf10466bce4750111d85))
* **main:** validate and create typed node files ([c10cb01](https://github.com/wannli/obsidian-nodes/commit/c10cb01251d5378bb3b8fa430134b9bb41fd7c22))
* **schemas:** add yaml schema validation and catalog ([889b792](https://github.com/wannli/obsidian-nodes/commit/889b792ca81f7023a2ac2adbff1ace28c3e8146b))
* **schemas:** configure six native highlight colors ([4573d66](https://github.com/wannli/obsidian-nodes/commit/4573d667bbb548fdb182a09bf3849f8910e052a1))
* **schemas:** report conflicting native property types ([3935a1b](https://github.com/wannli/obsidian-nodes/commit/3935a1bb0f55de7adb537b57ea19f9b1973db999))
* **ui:** add folder settings and schema diagnostics ([7dd681e](https://github.com/wannli/obsidian-nodes/commit/7dd681e0c8a01fafafb909ec4b1adc6d4d8c9cb9))
* **ui:** add native creation and node picker forms ([d03c3a4](https://github.com/wannli/obsidian-nodes/commit/d03c3a4b7fd359d7c10b969b8cbd149dbbd02062))
* **ui:** connect fuzzy linking and inline node creation ([30625fa](https://github.com/wannli/obsidian-nodes/commit/30625fa92353a03bf6dcc1a6548532c84d1e224d))
* **ui:** intercept at-symbol on selected text ([a8b3a79](https://github.com/wannli/obsidian-nodes/commit/a8b3a79381d5f0e072fbcbc2c8758125e24459af))
* **ui:** show node type inline in suggestions ([ac5be66](https://github.com/wannli/obsidian-nodes/commit/ac5be66d71f59f3b085ed31d04fd66bfb5f06272))
* **ui:** show type highlight in creation picker ([5836bac](https://github.com/wannli/obsidian-nodes/commit/5836bac87cae87700005ce17139110840b22dc09))
* **ui:** simplify creation form and submit with ctrl-enter ([8bbc29c](https://github.com/wannli/obsidian-nodes/commit/8bbc29c74015aa2fe7d21cb55cff8207a90b11a9))
* **ui:** simplify link dropdowns and shorten wikilinks ([7a2d464](https://github.com/wannli/obsidian-nodes/commit/7a2d4649a7415bf2850e1caaa3fa5ed38aa97d9d))
* **ui:** tint picker type tags with schema colors ([4749c2d](https://github.com/wannli/obsidian-nodes/commit/4749c2d69ffd80fbbb31e37223db5585743c5f94))


### Fixed

* **main:** rank native fuzzy scores in descending order ([0f436b3](https://github.com/wannli/obsidian-nodes/commit/0f436b3fe25a8dde39921c1004877765bac53fe0))
* **ui:** avoid inline suggestions in unsaved editors ([ce95078](https://github.com/wannli/obsidian-nodes/commit/ce9507849f6719319d98b1ee816629763acd434a))
* **ui:** place cursor after completed highlight link ([b3b4a86](https://github.com/wannli/obsidian-nodes/commit/b3b4a8632ee31af21abca70cfc9ba5f99cbf18aa))
* **ui:** prefill selected-text search and guard insertion ([5000f1f](https://github.com/wannli/obsidian-nodes/commit/5000f1f508ea633d22ad2eb911a892e027518bc1))
* **ui:** reject stale schema creation and allow clearing links ([8511b81](https://github.com/wannli/obsidian-nodes/commit/8511b817af891f5037ff6e84e96d65d9a812316b))
