import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SnapIndex,
  calibrate,
  checkAgainstStamp,
  expectedMetersPerUnit,
  findScaleStamps,
  orthoLock,
  pointInPolygon,
  polygonArea,
  polygonSelfIntersects,
  projectOnSegment,
  validateFloor,
  canApprove,
  CalibrationError,
  emptyFloorState,
  floorStateSchema,
  type FloorState,
} from "../src/index.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe("geometria", () => {
  it("área de um retângulo 4x3, nos dois sentidos", () => {
    assert.equal(polygonArea([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]), 12);
    assert.equal(polygonArea([{ x: 0, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 0 }, { x: 0, y: 0 }]), 12);
  });

  it("projeção fica dentro do segmento", () => {
    const r = projectOnSegment({ x: 20, y: 5 }, { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    assert.deepEqual(r.point, { x: 10, y: 0 });
    assert.equal(r.t, 1);
  });

  it("deteta polígono em laço", () => {
    assert.equal(polygonSelfIntersects([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), true);
    assert.equal(polygonSelfIntersects([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), false);
  });

  it("ponto dentro de polígono", () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    assert.equal(pointInPolygon({ x: 5, y: 5 }, sq), true);
    assert.equal(pointInPolygon({ x: 15, y: 5 }, sq), false);
  });

  it("orto bloqueia ao eixo dominante", () => {
    assert.deepEqual(orthoLock({ x: 0, y: 0 }, { x: 10, y: 2 }), { x: 10, y: 0 });
    assert.deepEqual(orthoLock({ x: 0, y: 0 }, { x: 1, y: -7 }), { x: 0, y: -7 });
  });
});

describe("escala", () => {
  it("cota de 4,20 m desenhada a 1:100 confirma o carimbo", () => {
    const pts = 4.2 / expectedMetersPerUnit(100);
    const cal = calibrate({ x: 0, y: 0 }, { x: pts, y: 0 }, 4.2, 100);
    assert.equal(checkAgainstStamp(cal, 100).ok, true);
    close(cal.metersPerUnit, expectedMetersPerUnit(100), 1e-12);
  });

  it("deteta PDF impresso com 'ajustar à página'", () => {
    const pts = (4.2 / expectedMetersPerUnit(100)) * 0.7; // reduzido a 70% → ≈ 1:143
    const check = checkAgainstStamp(calibrate({ x: 0, y: 0 }, { x: pts, y: 0 }, 4.2), 100);
    assert.equal(check.ok, false);
    close(check.effectiveDenominator, 142.857, 0.01);
  });

  it("rejeita valores absurdos", () => {
    assert.throws(() => calibrate({ x: 0, y: 0 }, { x: 100, y: 0 }, 0), CalibrationError);
    assert.throws(() => calibrate({ x: 0, y: 0 }, { x: 100, y: 0 }, 420), CalibrationError);
    assert.throws(() => calibrate({ x: 0, y: 0 }, { x: 1, y: 0 }, 4.2), CalibrationError);
  });

  it("encontra a escala no carimbo", () => {
    assert.deepEqual(findScaleStamps("PLANTA PISO 0 - ESCALA 1:100   det. 1/20"), [20, 100]);
    assert.deepEqual(findScaleStamps("tel 21 123 4567, área 1:7"), []);
  });
});

describe("snap", () => {
  const idx = new SnapIndex(
    [
      { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
      { a: { x: 100, y: 0 }, b: { x: 100, y: 100 } },
    ],
    10,
  );

  it("prefere extremos", () => {
    const r = idx.snap({ x: 98, y: 3 }, 6);
    assert.equal(r.kind, "extremo");
    assert.deepEqual(r.point, { x: 100, y: 0 });
  });

  it("depois o ponto médio", () => {
    const r = idx.snap({ x: 51, y: 2 }, 6);
    assert.equal(r.kind, "meio");
    assert.deepEqual(r.point, { x: 50, y: 0 });
  });

  it("depois qualquer ponto do segmento", () => {
    const r = idx.snap({ x: 30, y: 4 }, 6);
    assert.equal(r.kind, "segmento");
    assert.deepEqual(r.point, { x: 30, y: 0 });
  });

  it("pontos extra (geometria já desenhada) também atraem", () => {
    assert.equal(idx.snap({ x: 30, y: 41 }, 6, [{ x: 30, y: 40 }]).kind, "extremo");
  });

  it("fora da tolerância fica livre", () => {
    assert.equal(idx.snap({ x: 30, y: 40 }, 6).kind, "livre");
  });
});

describe("validação do piso", () => {
  it("piso vazio não pode ser aprovado", () => {
    const issues = validateFloor(emptyFloorState());
    assert.equal(canApprove(issues), false);
    assert.deepEqual(
      issues.filter((i) => i.level === "erro").map((i) => i.message),
      ["Escala por calibrar.", "Nenhuma divisão definida."],
    );
  });

  it("piso completo é aprovável e o schema aceita-o", () => {
    const u = 1 / expectedMetersPerUnit(100); // unidades por metro
    const state: FloorState = {
      scale: calibrate({ x: 0, y: 0 }, { x: 4.2 * u, y: 0 }, 4.2, 100),
      walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 4 * u, y: 0 }, thicknessM: 0.15 }],
      openings: [{ id: "o1", kind: "porta", wallId: "w1", t: 0.5, widthM: 0.8, hinge: "inicio", swing: "esquerda" }],
      rooms: [
        {
          id: "r1",
          name: "Quarto 1",
          types: ["quarto"],
          polygon: [{ x: 0, y: 0 }, { x: 4 * u, y: 0 }, { x: 4 * u, y: 3 * u }, { x: 0, y: 3 * u }],
        },
      ],
    };
    assert.equal(canApprove(validateFloor(state)), true);
    assert.equal(floorStateSchema.safeParse(state).success, true);
  });

  it("porta que sai fora da parede gera aviso", () => {
    const u = 1 / expectedMetersPerUnit(100);
    const state: FloorState = {
      ...emptyFloorState(),
      scale: calibrate({ x: 0, y: 0 }, { x: 4.2 * u, y: 0 }, 4.2),
      walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 1 * u, y: 0 }, thicknessM: 0.15 }],
      openings: [{ id: "o1", kind: "porta", wallId: "w1", t: 0.9, widthM: 0.8, hinge: "inicio", swing: "esquerda" }],
    };
    assert.ok(validateFloor(state).some((i) => i.ref === "o1" && i.level === "aviso"));
  });
});
