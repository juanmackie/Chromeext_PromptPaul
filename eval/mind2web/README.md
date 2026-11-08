# Mind2Web action subset

This fixed subset contains nine first-action examples from the Mind2Web **training** split. It is used only for evaluation and is not included in training corpora. The checked-in page snapshots have been modified to remove executable scripts, event-handler attributes, and external navigation/resource URLs. The source shard and subset hashes are recorded in `manifest.json`.

Annotated link targets that had their external destinations stripped receive a case-specific `/mind2web-target/<case-id>` path on the local fixture origin. The fixture prevents those clicks from navigating, so the benchmark can measure target selection without contacting a source site.

Mind2Web is by OSU-NLP-Group and is licensed under CC BY 4.0. Source: [OSU-NLP-Group/Mind2Web](https://huggingface.co/datasets/osunlp/Mind2Web), file `data/train/train_10.json`. Citation: Deng et al., _Mind2Web: Towards a Generalist Agent for the Web_ (2023), arXiv:2306.06070.
